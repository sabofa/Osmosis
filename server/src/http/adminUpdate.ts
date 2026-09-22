import type { FastifyInstance } from "fastify";
import { execFile, spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { AppContext } from "./app.js";

// ----------------------------------------------------------------------------
// Updating Osmosis from itself. The repo is the git checkout this node was
// installed from: OSMOSIS_REPO_DIR when set (the server's checkout lives
// beside the /opt copy it runs from), otherwise the nearest ancestor of the
// working directory that holds a .git. `update-check` fetches and compares
// HEAD with origin's default branch; `update` pulls fast-forward and hands
// off to the installer, which rebuilds and restarts the node. Data is never
// touched: it lives outside the checkout (/var/lib/osmosis, data/).
// ----------------------------------------------------------------------------

const run = promisify(execFile);

export function findRepoDir(start: string, override?: string | null): string | null {
  if (override) return existsSync(join(override, ".git")) ? override : null;
  let dir = resolve(start);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, ".git")) && existsSync(join(dir, "deploy"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// The checkout may belong to another user than the one running the node
// (the server's does): git refuses "dubious ownership" without this.
async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-c", `safe.directory=${repo}`, ...args], { cwd: repo, timeout: 60_000, windowsHide: true });
  return stdout.trim();
}

// Under systemd the node runs as a service user that can neither write the
// checkout nor run the installer with sudo; updating there is a shell step.
export const underSystemd = (): boolean => !!process.env.INVOCATION_ID;

export interface UpdateCheck {
  repo_dir: string | null;
  branch: string | null;
  local: { commit: string; subject: string; date: string } | null;
  remote: { commit: string; subject: string; date: string } | null;
  behind: number;
  ahead: number;
  dirty: boolean;
  changes: string[];
  error?: string;
  // Set when origin could not be fetched (no network, or a read-only
  // checkout): the comparison is against the last fetched origin ref.
  fetch_error?: string;
  // How to update when this process cannot do it itself.
  manual?: string;
}

export async function checkForUpdate(repoDir: string | null, fetch = true): Promise<UpdateCheck> {
  const none: UpdateCheck = { repo_dir: repoDir, branch: null, local: null, remote: null, behind: 0, ahead: 0, dirty: false, changes: [] };
  if (!repoDir) return { ...none, error: "This node was not started from a git checkout. Set OSMOSIS_REPO_DIR to the checkout to update from here." };
  try {
    const branch = await git(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    let fetchError: string | undefined;
    if (fetch) {
      try {
        await git(repoDir, ["fetch", "--quiet", "origin"]);
      } catch (err) {
        fetchError = (err as Error).message.split("\n")[0];
      }
    }
    const upstream = `origin/${branch}`;
    const show = async (ref: string) => {
      const out = await git(repoDir, ["log", "-1", "--format=%H%x1f%s%x1f%cI", ref]);
      const [commit, subject, date] = out.split("\x1f");
      return { commit, subject, date };
    };
    const local = await show("HEAD");
    const remote = await show(upstream);
    const counts = (await git(repoDir, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`])).split(/\s+/);
    const ahead = Number(counts[0] ?? 0);
    const behind = Number(counts[1] ?? 0);
    const dirty = (await git(repoDir, ["status", "--porcelain", "--untracked-files=no"])).length > 0;
    const changes = behind > 0 ? (await git(repoDir, ["log", "--format=%h %s", `HEAD..${upstream}`])).split("\n").filter(Boolean) : [];
    const result: UpdateCheck = { repo_dir: repoDir, branch, local, remote, behind, ahead, dirty, changes };
    if (fetchError) result.fetch_error = fetchError;
    if (underSystemd()) result.manual = `On the server: cd ${repoDir} && git pull && bash deploy/install.sh`;
    return result;
  } catch (err) {
    return { ...none, error: (err as Error).message };
  }
}

// Pull, then start the installer detached with its output in a log file
// under the data directory. The installer rebuilds and restarts the node;
// this process goes away underneath the caller, who polls /api/status.
export async function startUpdate(ctx: AppContext, repoDir: string): Promise<{ started: boolean; log: string; message: string }> {
  await git(repoDir, ["pull", "--ff-only", "--quiet"]);
  const log = join(dirname(ctx.env.dbPath), "update.log");
  const out = openSync(log, "a");
  const isWindows = process.platform === "win32";
  const child = isWindows
    ? spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repoDir, "deploy", "install-local.ps1"), ...(ctx.env.remoteUrl ? ["-RemoteUrl", ctx.env.remoteUrl] : [])],
        { cwd: repoDir, detached: true, stdio: ["ignore", out, out], windowsHide: true }
      )
    : spawn("bash", [join(repoDir, "deploy", "install.sh")], {
        cwd: repoDir,
        detached: true,
        stdio: ["ignore", out, out],
        env: { ...process.env, ...(ctx.env.role === "local" ? { OSMOSIS_ROLE: "local", REMOTE_URL: ctx.env.remoteUrl ?? "" } : {}) },
      });
  child.unref();
  return { started: true, log, message: "Pulled. The installer is rebuilding; this node restarts when it finishes." };
}

export function registerAdminUpdateRoutes(app: FastifyInstance, ctx: AppContext): void {
  const repoDir = findRepoDir(process.cwd(), ctx.env.repoDir);

  app.get("/api/admin/version", async () => {
    const check = await checkForUpdate(repoDir, false);
    return { repo_dir: check.repo_dir, branch: check.branch, commit: check.local, dirty: check.dirty, error: check.error };
  });

  app.get("/api/admin/update-check", async () => checkForUpdate(repoDir, true));

  app.post("/api/admin/update", async (_request, reply) => {
    if (!repoDir) {
      reply.code(400).send({ error: "no_repo", message: "This node was not started from a git checkout; set OSMOSIS_REPO_DIR." });
      return;
    }
    if (underSystemd()) {
      reply.code(409).send({
        error: "service_managed",
        message: `This node runs under systemd as a service user and cannot rebuild itself. On the server: cd ${repoDir} && git pull && bash deploy/install.sh`,
      });
      return;
    }
    const check = await checkForUpdate(repoDir, true);
    if (check.error) {
      reply.code(500).send({ error: "update_check_failed", message: check.error });
      return;
    }
    if (check.dirty) {
      reply.code(409).send({ error: "dirty_checkout", message: `${repoDir} has uncommitted changes; commit or stash them first.` });
      return;
    }
    if (check.behind === 0) return { started: false, message: "Already up to date." };
    try {
      return await startUpdate(ctx, repoDir);
    } catch (err) {
      reply.code(500).send({ error: "update_failed", message: (err as Error).message });
      return;
    }
  });
}
