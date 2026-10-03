// The special file types, imported once. Each one registers itself, in a module
// of its own, with registerWebFileType (see fileTypes.tsx):
//
//   import './itemFiles'
//
// and that import line is the only change outside that module. Workspace.tsx
// imports this file, so the registrations are in place before anything is
// rendered. (They cannot be imported from fileTypes.tsx itself: a module that
// calls registerWebFileType needs it to be defined first.)
export {}
