# Every project is a git repo: a plain folder gets git init when added

Adding a folder that isn't a repo runs `git init` and commits what's in it, so every lane works the same way.
`Project.isGit` and the "one card at a time" rule for non-git projects are gone. The only special case left is
a project with no remote, where Ship has nothing to push to.

## Detail
- Rejected dropping plain folders from the first version: `git init` keeps them supported for little cost.
- Known gap: the first commit takes whatever is in the folder, including files a `.gitignore` would normally
  keep out.
