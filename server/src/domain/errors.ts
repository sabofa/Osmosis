export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly detail?: unknown
  ) {
    super(message);
    this.name = "DomainError";
  }
}
