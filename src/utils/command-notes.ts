/**
 * Plain-English notes about a shell command. An approval that shows only the
 * command string asks the reader to be a shell expert; this says what the
 * command does and what it might cost them.
 */

export interface CommandNote {
  /** One clause per segment of the command. */
  summary: string;
  /** What could bite, in plain words. Empty when nothing stands out. */
  risks: string[];
}

const COMMANDS: Record<string, string> = {
  ls: "lists the files in a folder",
  ll: "lists the files in a folder",
  cat: "prints the contents of a file",
  head: "shows the first lines of a file",
  tail: "shows the last lines of a file",
  less: "opens a file to read",
  more: "opens a file to read",
  wc: "counts lines, words or characters",
  grep: "searches text for a pattern",
  egrep: "searches text for a pattern",
  rg: "searches files for a pattern",
  find: "finds files by name or property",
  fd: "finds files by name",
  tree: "draws the folders as a tree",
  du: "measures how much space a folder takes",
  df: "shows how much disk space is left",
  stat: "shows the details of a file",
  file: "says what kind of file it is",
  echo: "prints text",
  printf: "prints text",
  pwd: "prints the working folder",
  cd: "changes the working folder",
  mkdir: "creates a folder",
  touch: "creates an empty file or updates its time",
  rm: "deletes files",
  mv: "moves or renames a file",
  cp: "copies a file",
  chmod: "changes who may use a file",
  chown: "changes who owns a file",
  ln: "makes a link to a file",
  ps: "lists the running programs",
  top: "shows what the machine is busy with",
  kill: "stops a running program",
  pkill: "stops running programs by name",
  open: "opens a file or page with the default app",
  say: "speaks text aloud",
  defaults: "reads or changes macOS preferences",
  osascript: "runs an AppleScript",
  xattr: "reads or changes the metadata on a file",
  security: "manages keychain items",
  sw_vers: "shows the macOS version",
  git: "runs a git command",
  npm: "runs a package manager command",
  pnpm: "runs a package manager command",
  yarn: "runs a package manager command",
  bun: "runs a package manager command",
  npx: "runs a package from npm",
  node: "runs a Node.js script",
  deno: "runs a Deno script",
  python: "runs a Python script",
  python3: "runs a Python script",
  pip: "manages Python packages",
  pip3: "manages Python packages",
  brew: "manages Homebrew packages",
  docker: "runs a Docker command",
  kubectl: "talks to a Kubernetes cluster",
  make: "builds software from a Makefile",
  cmake: "configures a software build",
  swift: "builds or runs Swift code",
  cargo: "builds and runs Rust code",
  go: "builds and runs Go code",
  java: "runs a Java program",
  pytest: "runs the Python tests",
  vitest: "runs the tests",
  jest: "runs the tests",
  curl: "downloads something from the network",
  wget: "downloads something from the network",
  ssh: "opens a shell on another machine",
  scp: "copies files to another machine",
  rsync: "copies files, keeping them in sync",
  tar: "packs or unpacks archives",
  zip: "packs files into an archive",
  unzip: "unpacks an archive",
  date: "prints the date and time",
  whoami: "says who you are",
  which: "says where a program lives",
  env: "prints the environment variables",
  history: "prints the command history",
  man: "prints the manual of a command",
};

/** A second level of detail for the commands that mean different things per subcommand. */
const SUBCOMMANDS: Record<string, Record<string, string>> = {
  git: {
    status: "shows what changed and what is staged",
    log: "prints the history of commits",
    diff: "shows the changes between two states",
    add: "stages files for the next commit",
    commit: "saves the staged changes as a commit",
    push: "uploads commits to the remote repository",
    pull: "brings down the commits from the remote",
    clone: "copies a repository to this machine",
    branch: "lists or creates branches",
    checkout: "switches to another branch or file",
    switch: "switches to another branch",
    reset: "moves the branch to another commit",
    stash: "sets the changes aside",
    fetch: "downloads what the remote has",
    remote: "shows the remotes of this repository",
  },
  npm: {
    install: "installs packages",
    i: "installs packages",
    ci: "installs exactly what the lockfile says",
    run: "runs a script from package.json",
    test: "runs the tests",
    build: "runs the build script",
    start: "runs the start script",
    publish: "publishes the package",
  },
  pnpm: {
    install: "installs packages",
    i: "installs packages",
    run: "runs a script from package.json",
    test: "runs the tests",
    build: "runs the build script",
  },
  yarn: {
    install: "installs packages",
    add: "installs a package",
    run: "runs a script from package.json",
    test: "runs the tests",
  },
  bun: {
    install: "installs packages",
    run: "runs a script from package.json",
    test: "runs the tests",
    build: "runs the build script",
  },
  brew: {
    install: "installs a package",
    uninstall: "removes a package",
    list: "lists the installed packages",
    update: "updates Homebrew itself",
    upgrade: "updates the installed packages",
  },
  docker: {
    build: "builds an image",
    run: "runs a container",
    ps: "lists the running containers",
    compose: "runs the containers this project describes",
  },
};

const RISKS: { pattern: RegExp; note: string }[] = [
  { pattern: /\bsudo\b/i, note: "runs as the superuser, so it can change anything on this Mac" },
  { pattern: /\brm\b[^\n]*\s-[a-z]*[rR][a-z]*\s/i, note: "deletes files, and the trash does not get them back" },
  { pattern: /\b(curl|wget)\b[^\n]*\|\s*(ba|z|k)?sh\b/i, note: "runs a script downloaded from the internet" },
  { pattern: /\bchmod\b[^\n]*\b777\b/, note: "makes a file readable and writable by everyone" },
  { pattern: /\bkill\b[^\n]*\s-9\b/, note: "force-kills a program, so it cannot clean up" },
  { pattern: /\bdefaults\s+write\b/i, note: "changes a macOS system preference" },
  { pattern: /\bnpm\s+publish\b/i, note: "publishes a package to the public registry" },
  { pattern: /\bgit\s+push\b[^\n]*(--force|-f)\b/i, note: "overwrites the history on the remote" },
  { pattern: /\bgit\s+reset\b[^\n]*--hard\b/i, note: "throws away changes that were not committed" },
  { pattern: /\bdd\b[^\n]*of=\/dev\//i, note: "writes straight onto a disk device" },
  { pattern: /\bmkfs\b/i, note: "formats a disk" },
  { pattern: />\s*\/etc\//, note: "overwrites a system file" },
  { pattern: /\bdiskutil\b[^\n]*\berase\b/i, note: "erases a disk" },
];

/** Splits a command into the pieces that each run on their own. */
function segments(command: string): string[] {
  return command
    .split(/\|\||&&|[;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The program a segment runs, ignoring leading `KEY=value` assignments. */
function program(segment: string): string {
  const words = segment.split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
    const name = word.split("/").pop() ?? word;
    return name.replace(/[^A-Za-z0-9._-]/g, "");
  }
  return "";
}

function subcommand(segment: string): string {
  const words = segment.split(/\s+/).filter(Boolean);
  const index = words.findIndex((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  if (index < 0) return "";
  return (words[index + 1] ?? "").replace(/[^A-Za-z0-9:_-]/g, "");
}

/** Says what a command does, one clause per segment. */
export function describeCommand(command: string): CommandNote {
  const parts = segments(command);
  if (!parts.length) return { summary: "runs an empty command", risks: [] };

  const clauses = parts.map((part) => {
    const name = program(part);
    if (!name) return "runs nothing";
    const sub = subcommand(part);
    const detail = SUBCOMMANDS[name]?.[sub];
    if (detail) return `runs ${name} ${sub}, which ${detail}`;
    const known = COMMANDS[name];
    if (!known) return `runs ${name}, which this app does not recognize`;
    return `runs ${name}, which ${known}`;
  });

  const risks: string[] = [];
  for (const rule of RISKS) {
    if (rule.pattern.test(command) && !risks.includes(rule.note)) risks.push(rule.note);
  }

  return { summary: clauses.join(", then "), risks };
}
