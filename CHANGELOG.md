# Changelog

All notable changes to OpenMonkey are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions match the tag
that produced the build.

## Unreleased

### Added

- **A license you can check on this Mac, and a trial that starts the day you do.**
  Settings → License says what this copy may do. A fresh install is on a fourteen-day
  trial of Pro — publishing to your own channels, posts queued for later and drafts you
  read before they go out — and the day the trial started is remembered on disk, so a
  restart does not hand out another fortnight. When the trial ends there is a seven-day
  grace period, and after that the app falls back to the free tier, which keeps chat,
  tools and memory and says plainly that publishing needs a license. A license is a
  file: a signed JSON document, checked on this disk with an Ed25519 signature against
  the public key that ships inside the app. Nothing is asked of the network — there is
  no phone-home, no account and no request that leaves the Mac — and the private half
  of the signing key stays in the author's keychain, where a script on the author's own
  machine reads it to mint a license. A license may be bound to one Mac, and a license
  that was issued for another one is refused here; the binding is a hash of the
  machine, so the raw values are never written down. Settings → License takes a
  license as pasted text or as a file you pick, says why a file was refused rather
  than failing quietly, and can take the license off again. Publishing is gated in one
  place — the publisher itself — so the agent's own posts, the posts the app sends
  for you and the posts you send from the settings page are all refused the same way
  and with the same words. 11 unit tests (the canonical payload signing to the same
  bytes twice, a license signed by the author's key and by nobody else's, a tampered
  payload and a tampered file both refused, the trial and the grace period running
  out, a license turning Pro on and taking it off again, a license bound to another
  Mac refused, and the paid action saying what it needs), 6 integration tests (a post,
  a draft, a queued post and a post queued from the settings page all refused before
  anything reaches the network, a licensed post going out as before, and a fresh Mac
  being on trial) and an e2e spec that opens the page, reads the trial and refuses a
  forged license.

- **The agent can write a post down for you to read, instead of sending it.** Ask it to
  draft something — "draft a note for my Telegram channel about the release" — and it
  writes the post down and stops there. Nothing goes out. The draft waits in
  Settings → Publishing, where you read it, change the wording if you want, and then
  either send it or queue it for later. The wording you leave is the wording that goes
  out, byte for byte. Sending from that page runs the post through the same machinery as
  any other post, so it lands in the activity rail and in the audit log, the hourly cap
  and the gap between two posts still hold it back, the network switch still holds it,
  and the approval policy still refuses a post it would refuse. A draft that asks for
  upvotes is refused before it is even written down; a draft that will not fit the
  channel — too long for Bluesky, a Reddit post with no title — is written down anyway
  but says plainly that it will not go out as it stands. The text of a draft is sealed in
  the encrypted database like a message body, and a draft is removed only when the send
  or the queueing actually worked, so a failed send never loses what you wrote.
  11 integration tests (the agent writing a post down instead of sending it, a draft
  asking for votes refused, a draft that will not fit saying so, the agent seeing the
  drafts it wrote, a draft without text or an unknown channel refused, the wording the
  user wrote being the wording that goes out, the text of a draft sealed in the database,
  a draft queued under the same rules as an immediate post, a draft asking for votes
  refused again at queueing, a time in the past refused, and the app's own queue holding
  a scheduled draft) and a unit test that the two new actions are declared the way the
  drafts page reads them.

- **The app posts for you later, on its own.** A post can now be queued instead of
  sent, and the app sends it when the time comes. Ask for it in the ordinary way — "post
  this to my Telegram in two hours" — and the app shows the exact text, the channel and
  the hour, and waits for you to approve it exactly as it does for a post that goes out
  straight away. After that it waits in the app: a small ticker in the main process
  looks every 30 seconds for a post whose time has come, and sends it under your own
  account without asking a second time, because you already read the text and said yes.
  The post still runs as a task, so it shows up in the activity rail and in the audit log
  like any other thing the app did. The time is read the way a person says it — "in 45
  minutes", "in 2 hours", "in 1 day" — or as a date and an hour; a time the app cannot
  read is refused, a time in the past is refused, and a post cannot be queued more than
  30 days ahead. The queue waits rather than pushes: during your quiet hours nothing
  goes out, and it goes out when the day starts again; while the network switch in
  Settings → Privacy is off it waits; and the same hourly cap and the same minimum gap
  between two posts that hold an immediate post hold a queued one, so a queue cannot
  turn into a burst. A post that fails is tried three times and then given up on, with
  the reason kept and shown. If the publishing policy in Settings → Approvals is set to
  Block, a queued post is refused too, and says so rather than going out quietly.
  Settings → Publishing grows a **Scheduled posts** section listing every post waiting
  and every post that already went, with the time it went and the reason it did not,
  and a **Cancel** button on the ones that have not gone out yet. The text of a queued
  post is sealed in the encrypted database like everything else the app stores, so it
  disappears with "Erase everything" and is pruned with the rest of the history.
  13 integration tests (a scheduled post waiting for its time instead of going out, a
  time the app cannot read refused, a time in the past refused, a post without a saved
  token refused, a Reddit post without a title refused, the time read the way a person
  says it, the ticker sending a post whose time has come, a post that is not due left
  alone, the ticker waiting through the quiet hours, waiting while the network is off,
  waiting when the channel has no room left, giving up when the policy blocks it, a
  failing post being tried again and then given up on, and the text of a queued post
  sealed in the database) and a unit test that the two new actions are declared the way
  the queue and the model read them.

- **The app posts to Bluesky and Mastodon as well.** The publisher now carries four
  channels: the Telegram channel and the Reddit account it already had, plus a
  **Bluesky** account and a **Mastodon** account. Settings → Publishing grows two
  sections. **Bluesky** asks for the handle the app posts as and the app password from
  the account's own settings; the app signs in with the AT Protocol and refuses to post
  if the sign-in belongs to a different account than the handle you set, so a token
  cannot go out under the wrong name. **Mastodon** asks for the instance the account
  lives on and the access token from the instance's developer page; the instance has to
  be an https address, because the token travels with every post. Both secrets go into
  the macOS keychain like the other two, and the page never shows one of them again.
  Both channels carry a picture: the app fetches it itself and uploads it first, then
  writes the post pointing at it — Bluesky under a 1 MB limit, Mastodon under 10 MB. A
  picture address on the local network is refused before anything is fetched, so the app
  cannot be talked into reading the machine it runs on. The limits the platforms set are
  the app's own: a Bluesky post holds 300 characters a reader can see, so an emoji
  counts as one rather than two, and a Mastodon post holds 500. The hourly cap and the
  gap between two posts cover the new channels too — 10 an hour for Bluesky, 5 for
  Mastodon, and a minute between Mastodon posts — and the counts survive a restart. 9
  integration tests (a Bluesky post signing in and writing the record, a picture being
  uploaded before the post that points at it, a sign-in for another account refused, the
  300 characters counted the way a reader sees them, a Mastodon post uploading the
  picture and then the status, an instance that is not https refused, the 500 characters,
  a picture from the local network never fetched, and the check naming the Bluesky and
  the Mastodon account) and the secret of each channel holding only what that channel
  needs.

- **The app speaks Arabic.** Settings → Appearance → Language now offers العربية next to
  English and Русский, and picking it turns the whole interface the other way round: the
  side panel stands on the other side of the window, the rule that separates it follows,
  the arrows that mean "back" and "forward" point back, the switches slide towards the
  end of the line and the theme previews are mirrored. Every one of the 487 strings is
  written in Arabic — the window, the tray, the menu bar and the native menus all read
  in it, and the twelve moods are named from the one table the window and the tray share,
  so the two cannot call the same mood by different names. The dates and figures are
  written the way Arabic writes them: ١٬٢٣٤٫٥ for a number, ٥ نوفمبر for a day,
  ٠٣:٠٠ م for an hour. The strings are written, not reviewed — nobody whose first language
  it is has read them yet, and the app does not claim otherwise. 6 unit tests
  (every language carrying every string and none of them empty, the Arabic being Arabic
  and not the English left behind, the language change turning the document and the
  direction together, a figure and a day written the way Arabic writes them, and the mood
  named in the language that was picked).

- **The app tells you what it knows about updates, and can walk you back.** Settings →
  Desktop now carries an **Updates** card with three parts. **Update status** says
  plainly where you stand — the build you are running is the newest, a newer one is
  waiting, one is on its way, the check is running, the network switch in Privacy keeps
  the app from looking, or the check failed and says why. A release can be offered to
  only part of the installs, and when it is, the card says how much of it has been let
  out; a build that was not picked says so and waits for the next check rather than
  pretending the release does not exist. **Release notes** reads the changelog the
  release was built from, the same file the build carries, so what you read in the app
  is what the release was made from. The notes for the work still in progress are shown
  as *Not out yet*. **Go back to the previous version** finds the release before the one
  you are running, fetches its disk image into your Downloads folder and opens it, so
  you can put the older build back yourself; a release that ships no disk image is
  passed over and the next older one is used, and with the network switch off nothing
  is fetched at all. 21 unit tests (a release sharing its number with the installs
  that are let into it, a new group of installs for every release, a share of 100
  reaching everybody and a share of 0 reaching nobody, a share of 25 reaching about a
  quarter, a share outside the scale being clamped; the changelog read into its
  version and its day, the notes sitting under their heading, an unknown version
  having none, a note wrapped over two lines joining the note above it, a note with no
  heading landing under *Changes*; the rollback picking the newest release older than
  the running one, skipping drafts and pre-releases, passing over a release with no
  disk image, having nothing to go back to when the running build is the oldest, and
  finding nothing when the version cannot be read) and 11 integration tests (an
  unsigned build naming the release instead of downloading one, the release page
  opening, a signed build fetching the release and asking before it restarts, a
  declined answer changing nothing, a release offered to nobody sitting held, a full
  release being fetched, an unpackaged app starting no updater, a build that was never
  installed reporting itself as local, the older build fetched into Downloads under
  its own name and opened, and the network switch off fetching nothing).

- **The history can be filed, labelled, put away and taken with you.** The sidebar now
  organizes the chats instead of only listing them. **Organize** opens a panel of folders,
  labels and saved searches: a folder holds the chats filed under it and says how many
  they are, a label is written in lower case and kept once per chat, and a saved search
  keeps the words you look for under a name you gave it. **Archive** takes the list over
  to the chats filed away and brings them back. The **⋯** button on a chat opens the
  menu that files it, labels it, renames it or deletes it. **Select** marks several chats
  so they can be exported at once — the export is sealed with a passphrase you type for
  the occasion, so a selection of private chats stays private, and the file is written
  `0600`. Deleting a folder keeps the chats and only takes the filing away, and a label
  nobody uses any more is not listed. 11 integration tests (a folder holding and counting
  its chats, a deleted folder keeping the chats, a chat filed under a folder that does not
  exist staying where it was, labels counted and lowercased and kept once, a label
  leaving with the chat it was on, an archived chat leaving the list and coming back, a
  saved search keeping its name and its query, an export carrying only the chats that
  were chosen, an export of nothing carrying nothing, the export handler writing a
  sealed file that holds only the chosen chats, and the handler refusing an empty
  selection and a short passphrase).
- **The menu bar and the Dock know your work.** The tray now holds the chats you were
  in — the pinned ones first, the ones you touched last after that — and the list is
  built again every time the menu opens, so it is never the list it was an hour ago.
  A new chat starts from the menu bar without opening the window first, and picking a
  chat from the list brings it into the window. The files you bring into a chat are
  kept by the Dock, so the Dock menu and File → Open Recent can hand them back: the
  file lands in the composer of the open chat, and the main process reads it, because
  a file you chose in the OS is not one the renderer may read on its own. When the mood
  turns while the app is in the background, the Dock icon nods once — a bounce under
  your eyes would be noise. 6 unit tests (the chat list: the newest first, a pinned
  chat before a newer one, a quick ask and an archived chat kept out, the list capped,
  a long title cut to one line) and 10 integration tests (the tray starting a chat,
  listing the recent ones and opening the one that is picked, an empty history saying
  so, the list fresh at every opening, the tray in Russian; a text file carried with
  its own text, an image named rather than read, a file too big or not text refused,
  and an attached file kept by the Dock).
- **Accessibility is checked, not promised.** The app now reads its own screen the way a
  reader does: the name of every control, the label of every field, the alt text of every
  image, the focus path inside a dialog, and the contrast of each run of text against what is
  actually painted behind it — judged at the size it is drawn, 4.5 to 1 for body text and 3 to
  1 for large. The rules live in `src/utils/a11y.ts` with no DOM in them, so they are
  unit-tested; the browser is only asked what it is currently showing. The colour half of the
  gate reads the stylesheet itself: the token cascade in `global.css` is resolved the way a
  browser resolves it and every text token is contrasted against every surface, for all eight
  accent swatches in both themes. That is what moved the palette — `muted`, `faint`,
  `accent-ink`, `danger` and `warn` now hold values that clear AA at 11.5px, and paint on the
  accent comes from one `--color-on-accent` token instead of a hardcoded near-black that read
  4.46 to 1 under the Slate swatch. Settings → Privacy → Diagnostics carries a "Check this
  screen" row that runs the same audit over the window in front of you and lists what it found,
  and CI runs it against the real app in both themes and fails on any finding.
- **True black, for a screen that keeps its pixels off.** Settings → Appearance has a
  "True black" switch that repaints the dark theme on `#000000` — the paper, the cards and
  the sidebar — so an OLED panel draws nothing where there is nothing to read, and the
  window stops letting the desktop through it. The palette gate measures it as a scheme
  of its own: the true-black tokens are resolved from the same stylesheet and contrasted
  against every text token for all eight accent swatches, and the e2e opens the app in
  true black to confirm the screen is painted on black and still passes the audit.
- **Each theme is packed as tightly as its own setting says.** Density used to be one
  switch for the whole app, so a compact dark theme meant a cramped light one too.
  Settings → Appearance now has a density row per theme, and the app follows the theme
  it is actually showing: pack the dark theme and the light theme does not move. A
  config written before the split keeps the density it had — in both themes — so
  nothing is quietly reset on upgrade.
- **The colours can be your own.** Settings → Appearance now has a Colours card: paper,
  card, second card, line, ink, muted, faint and sidebar can each be picked by hand, for
  the light theme and the dark theme separately, and the app repaints with them
  immediately. The colours mixed from the accent — the accent's own text, its tint, the
  message bubble — follow the card you picked, exactly as the stylesheet would mix them.
  The card says out loud which pairings fall below AA for the theme you are editing,
  because a palette that cannot be read is a bug, not a preference, and one button puts
  the built-in colours back. The tokens are stored in your own config file, not in the
  app's data, and a value that is not a colour is dropped rather than written into a
  stylesheet.
- **The agent can find pictures on the internet.** `web.image_search` asks two openly
  licensed indexes — Openverse first, Wikimedia Commons behind it — and answers with the
  direct image URL, the page the picture came from, its author and its licence, so a
  result is something you may actually publish rather than a thumbnail of unknown
  rights. DuckDuckGo's and Bing's image endpoints were tried first and rejected: they
  bot-challenge most shared networks and return no rights information at all.
  `web.save_image` downloads one of those hits into your own folders. The approval names
  the destination, only `image/*` responses are written, the file is capped at 25 MB,
  robots.txt is respected, and a path outside the folders you gave the agent is refused
  before a single byte is fetched. Both actions sit behind Settings → Privacy → network
  access, so with the switch off neither request leaves the Mac.
- **Analysis reports quote numbers the app measured.** `file.inspect` walks a folder and
  answers with what a report actually needs — rows and columns, per-column min, max, mean
  and sum, the values behind a category, the keys and shape of a JSON document, headings
  and word counts — instead of handing the model a truncated page and hoping it adds up.
  Tables are recognised by their shape rather than only by `.csv`, so a report exported as
  `.txt` still gets measured. A file bigger than the 4 MB read cap is measured up to the
  cap and says so, binary files are named rather than parsed, the walk stops at 40 matches
  and reports the stop, and nothing is written: the action needs no approval.
- **The agent can post to your own Telegram channel or Reddit account.** `publish.post`
  goes out under your own account — never a third party's — and stops for approval
  first, because a post cannot be taken back. The credentials live in the macOS
  keychain: the Telegram bot token, and for Reddit the script app id, the app secret,
  the account name and the account password. They are never written to the settings
  file, and on a Mac with no keychain the app refuses to store them at all rather than
  fall back to plaintext. The target — the chat id, the subreddit — comes from
  Settings → Publishing, so the model cannot post to a channel you did not name. The
  app also keeps itself slow, because a channel that answers every few minutes reads as
  a bot: ten posts an hour on Telegram, two on Reddit, a quarter of an hour between
  Reddit posts, and the count survives a restart. A post that asks for upvotes,
  comments or follows is refused before it leaves the Mac, since that is what gets an
  account removed. `publish.list_channels` reports what is set up and how much room is
  left, without ever showing the token. Both actions sit behind Settings → Privacy →
  network access.
- **An approval can be answered from the notification itself.** The banner macOS shows
  when a tool wants your yes now carries **Allow** and **Deny**, so a decision no longer
  needs the window in front of you: press one and the tool runs, press the other and it
  is refused. The dialog that was waiting for an answer closes by itself, in the main
  window and in Quick Ask alike. The buttons can be turned off in Settings → Desktop,
  where macOS — which decides on its own whether a banner shows actions at all — is
  named as the one that has the last word. Quiet hours are there too: pick the hours,
  and the notifications stay quiet inside them while the Dock badge still counts what
  waits for you. A window that is already in front still gets no banner at all, and the
  app never answers an approval twice.
- **The app keeps copies of your history and says whether they are readable.** Settings →
  Privacy now has a Storage row that runs SQLite's own integrity check against the
  database, lists the copies the app has made and lets you put one back. A copy is taken
  on launch when the newest one is older than twelve hours, so a laptop that slept
  through its interval still gets one, and then every twelve hours while the app runs —
  only while it runs, because nothing here is a background service. The five newest
  copies are kept, each written `0600` in a folder that is `0700`, so another account on
  the Mac cannot read them. Putting one back is undoable by design: the live database is
  snapshotted into the rotation first, the button needs two presses, and a name that is
  not one of the app's own copies is refused before the folder is opened. Copies work
  while the history is locked with a passphrase, because the file is a plain SQLite
  database and only the row values are sealed. A damaged database is named with the
  verdict SQLite gave, not with a spinner.
- **A launch that cannot be bricked by its own config.** OpenMonkey now comes up in safe
  mode when a launch asks for it — `--safe-mode` on the command line,
  `OPENMONKEY_SAFE_MODE=1` in the environment, or the button in Settings → Privacy →
  Diagnostics — and when the app died twice in a row before it could mark itself running.
  A safe launch opens the window without the local model, without the MCP servers and
  without the update check, and the banner at the top of the app says exactly that, with
  a button that restarts the app the ordinary way. The count of launches that died is
  kept in `safe-mode.json` in the app's own profile folder, and a launch that reaches the
  point of being usable clears it: only a launch that keeps failing is answered with one.
  The chat is still there — the history is the one thing safe mode does not take away.
- **An answer that was cut off can be carried on.** The answer is written to the disk
  while the model is still writing it, so a crash, a quit or a lost connection no longer
  takes the whole reply with it: the part that was written is there when the app comes
  back, marked as unfinished. Such an answer carries a **Continue** button that asks the
  model to pick the thread up where it stopped — the part already written is kept, the
  new text grows on the same row instead of becoming a second answer, and the turn the
  model left off in is put back in front of it so it does not write the whole thing
  again. A model that starts the answer over anyway has that repeat taken off; one that
  only resembles what is written is left alone rather than cut in the wrong place. An
  answer you stopped yourself is recorded as stopped and is not offered for a carry-on:
  only an answer the app lost is.

### Changed

- **A release is no longer fetched unless it is wanted.** The updater stopped
  downloading a release on its own the moment it saw one. It now asks first, says what
  it found, and only fetches when the release can actually be installed. An unsigned
  build cannot replace itself, so it names the release and opens the release page
  instead of offering a restart into something macOS will refuse to install.
- **The update archive is fetched whole.** The archive keeps one name for every
  version, so the blockmap of the build that is running and the blockmap of the
  release on offer are the same file. A patch built from them would not be the
  release, so the whole archive is fetched and the differential download is turned off
  rather than left to fail.
- **A release can be let out slowly.** The publisher sets the share of installs a
  release is offered to in the update manifest, and each install decides on its own
  whether it is in that share, with no account and no telemetry: the number comes
  from a random file in the app's own folder, which never leaves the Mac.
- **A long chat no longer builds every message.** The chat panel mounts only the messages
  near the reader — a screenful of them — and the ones above and below stand in as the
  space they would take, so the scrollbar still tells the truth about how long the chat
  is. Every message is measured as it appears, so the space is its real height and not a
  guess, and the message you were reading is put back where it was when the rows around
  it change size. The chat keeps its newest message in view until you deliberately
  scroll up into the past: a chat that grows while you watch it no longer leaves you
  staring at the top of the history, and a layout that shrinks or grows under you is not
  mistaken for you leaving. Opening a chat lands on its newest message, as it always did. A
  history of six hundred messages mounts fewer than sixty of them; the end-to-end suite
  measures that on every run and prints the number, and the scroll geometry, into the
  log.
- **Markdown is parsed while the answer arrives, not after it.** While the model is
  still writing, only the unfinished tail is parsed again — the blocks that are already
  finished are kept as they are, so a long answer stops being re-read on every token. A
  message that is opened again from the history is parsed once and kept in a bounded
  cache, so a long history does not hold a copy of every answer it has ever shown.

### Fixed

- **The interface can turn the other way round.** Every margin, padding and rule that was
  pinned to the left or the right of the window was rewritten to follow the direction the
  text runs in, so a language written from the right gets its side panel on the other side
  of the window, its spacing the other way round and its arrows pointing back. The arrows
  that mean "back" and "forward" turn with the text; the ones that mean "send" or the
  Return key stay as they are, because a key does not point anywhere. The switches slide
  towards the end of the line instead of the same end every time, and the theme previews
  are mirrored rather than pointing at a panel that has moved. The document now says which
  way it runs, and the direction follows the language the reader picked. Arabic is the
  language that asks for the mirror, and it ships with the app. 6 unit tests (no class pinned to one side, no property in the stylesheet either,
  the arrows carrying the turn, the hand-drawn parts having a mirrored version, the
  document saying which way it runs and the language deciding) and 2 end-to-end tests
  (the panel standing at the other side of the window with the rule following it and the
  arrow pointing back, and the switch sliding the other way).

- **The dates and figures read in the language the app is in.** Dates were formatted with
  the Mac's own locale and numbers with a hard-coded `en-US`, so a reader who picked
  Russian on an English Mac was shown English months and English digits: the day under a
  chat message, the size of a model download, the seconds a reply took, the tokens it
  used, the date a memory was written, the date of the last prune. One formatter module
  now builds every date, time, figure and size from the language the app is in, and the
  locale data behind it is read once at start-up rather than inside the first render of
  a message that is arriving — the first formatter of a language costs about 23 ms, and
  paying that while an answer streams shows up as a stalled frame. A value that is not a
  date reads as a dash rather than as "Invalid Date". Quick Ask's relative times were
  worse: the formatter was built when the module was loaded, so they stayed English for
  the whole run no matter which language was chosen. The counts inside a sentence follow
  the same rule — the tokens a reply used, the messages in a chat, the tools an MCP
  server offers, the elements the accessibility check read. 12 unit tests.
- **Your chats are yours to read even before the model loads.** The sidebar's session
  list and the open tabs were restored only after the agent reported `ready`, so a Mac
  with no weights on disk — every first run from the DMG, and every machine still
  downloading them — opened the app to "No chats yet" over conversations that were
  sitting in its own database. The list now loads as soon as there is an agent to ask.
- **CI runs on a runner image that still exists.** GitHub retired the macOS 14 arm64
  image on 2 November 2026, and a job that names a retired image is cancelled a second
  after it starts, with no log to read — two pushes in a row looked like a build that had
  silently done nothing. The jobs ask for `macos-latest`, which always names the current
  arm64 image.

### Testing

- The end-to-end suite says which of its specs need the pinned Bonsai weights, from one
  shared check instead of eight copies of the same path, and skips the rest on a runner
  that has never downloaded 546 MB. CI's e2e leg went from nine failures to none for
  every spec that does not actually ask the model for tokens.
- The streaming test still measures frame gaps on a runner but no longer judges them:
  without a display to composite for, the window is paced by the host and the same
  stream that never exceeds 40 ms locally read 283 ms on CI.
- Nine headless tests cover the image tools with every fetch stubbed: attribution and
  licence in the answer, the fallback when the first index is down, a non-image refused,
  an oversized file refused, a path outside the workspace refused without downloading,
  and nothing fetched at all when the network switch is off.
- The motion spec stopped reading the settings page. It measured the chat panel's spring
  but never navigated to the chat, relying on the starter-prompt spec to leave it there —
  and that spec is skipped on a machine with no model, so on CI the panel was absent and
  its transition duration came back as nothing. A spec that needs a surface now opens it.
- Twenty-seven tests cover the measuring pass: eighteen on the facts themselves (quoted
  commas and newlines inside a field, `n/a` in a price column, money signs, ragged rows,
  a `.txt` export read as a table, a wide table that says what it left out) and nine that
  run the tool over real files on disk, including one over the read cap and one over a
  folder of 45 matches. Writing the capped-file test is what found the first crash: min
  and max were taken with a spread over the whole column, so a 330 000-row export blew
  the call stack. They are folded in a loop now.
- Fifteen tests cover the publisher with every request stubbed: the Telegram message and
  the photo caption, the Reddit token and the submit call, the refusal of a post that asks
  for upvotes, the hourly cap, the gap between two posts, the missing token and the
  missing target, the length limits of each channel, and nothing fetched at all when
  the network switch is off. The saved token never appears in what the model is told.
- The settings pages check their own row titles against the search index without a
  window. The end-to-end sweep types every row a page renders into the search box, but
  it needs a screen; a headless test now reads the same titles out of the page source
  and asks the index for them. It caught the publishing policy row, which had been
  added to the Approvals page without being added to the index.
- Twelve headless tests cover the notification: the banner carries Allow and Deny,
  pressing Allow answers the approval with a yes, pressing Deny with a no, the buttons
  stay away when they are turned off, a window that is in front gets no banner, quiet
  hours silence it and the morning brings it back. Five more cover the hours
  themselves, including a window that runs past midnight and a pair that means nothing.
- Twenty-seven headless tests cover the chat window and the incremental parser without a
  screen: a chat of five hundred messages mounts a screenful and nothing more, the
  space above and below adds up to the height of the whole list, a measured message
  beats the guess, and a reader in the middle gets what is around them. Twelve of them
  cover when the chat follows its newest message: a chat taller than the window keeps
  it in view, scrolling up into the past stops it, a layout that shrinks or grows
  under the reader is not mistaken for the reader leaving, a scroll of a few pixels is
  not a scroll at all, scrolling back to the end starts it again, and a pin the chat
  made itself is not read as the reader leaving — the case the end-to-end run caught on
  CI, where a five-hundred-message history pinned to 12,683 and the follow machine,
  still holding 12,854 from before the pin, froze the window mid-history. The parser keeps
  the blocks that are finished, produces the same blocks a full parse would, and parses
  again when the answer is replaced, when a code fence is still open, or when a quote is
  still growing. The end-to-end suite measures the same thing with a real window: a
  history of six hundred messages mounts fewer than sixty message bodies, the scroll
  height still covers all six hundred, the newest message is the one left on screen,
  and scrolling to the middle moves the window there instead of mounting the lot.
- Eight integration tests run the copies against real SQLite files: a launch writes one
  and a launch with a fresh copy writes nothing, a copy stands on its own when it is
  opened without the app (the chat written before it is read back out of the file),
  only the five newest survive a rotation, a sound database says "ok", a database whose
  second page has been scrambled over is reported as damaged with the verdict SQLite
  gave, putting a copy back drops the chat that came after it and brings the one it
  holds while the live connection keeps writing, a name that is not one of the app's
  copies — `../../secret.key`, a nested folder, an empty string — is refused and leaves
  the live file byte-for-byte unchanged, and the status names its own interval instead
  of hardcoding one. Two end-to-end specs run the same thing through the page: the
  Storage row checking a live database, copying it on demand and the files on disk
  carrying `0700` and `0600`, and a restore that arms on the first press, completes on
  the second, and drops the verdict it can no longer stand behind. The copy rows carry
  a mark saying their title is data, so the cross-page search sweep reads the rows that
  name a setting instead of typing out a timestamp — which is exactly what it caught on
  the first run.
- Ten headless tests cover safe mode without a window: the flag on the command line and
  the variable in the environment both ask for it, a launch that never got past its start
  is counted while a launch that came up is counted for nothing, a clean exit and a
  manual clear wipe the count, a marker file that is missing or unreadable does not stop
  the app, and a restart adds the switch once or takes it away again. One integration
  test runs the real start-up path against a profile that died last time, and one
  end-to-end spec launches the app with the switch on and reads the banner, the agent
  status, the empty MCP list and the marker file behind them.
- Six unit tests cover the repeat that is taken off a carried-on answer: a continuation
  that picks up where the answer stopped, one that writes the answer again and then goes
  on, one that only repeats, one that stops in the middle of the repeat, one that merely
  resembles the answer and is therefore left whole, and an empty continuation. Seven
  integration tests drive the agent itself with a stand-in model: an answer is on the
  disk and marked unfinished while it is still being written, a cut-off answer keeps its
  part and grows on the same row when it is carried on, the model is asked to continue
  rather than to start again, and an answer that has ended, an answer that is not there
  and a question of the user are each refused. One end-to-end spec reads the button in
  the page: the cut-off answer offers it and the finished one does not.

## 0.9.2 — 2026-11-05

The tag whose pipeline actually publishes. 0.9.1's build died before it could upload
anything, so `releases/latest/download/OpenMonkey-arm64.dmg` was a 404 and the landing
page linked to it; this release is the first file anyone can download.

### Fixed

- **A tag now reaches GitHub Releases.** The package job passed the Apple signing
  secrets as environment variables even when the repository has none, and
  electron-builder read an empty `CSC_LINK` as a certificate path and failed the build.
  The names are now absent rather than blank, so an unsigned build completes and the
  release job publishes the DMG, the updater zip, their block maps and `latest-mac.yml`.
- **Installed builds show their mood art.** `assetPath()` joined onto
  `Contents/Resources`, but the builder copies the folder to
  `Contents/Resources/assets`, so every packaged run looked for the twelve portraits one
  directory too high and the tray and Dock stayed empty.

### Changed

- **The updater promises only what it can do.** On a build without a Developer ID
  signature it no longer downloads an archive it cannot install; a new version now
  names itself and opens the release page, and the download-and-restart path stays on
  for signed builds. Settings → Desktop → Updates says the same thing.

## 0.9.1 — 2026-11-04

The first build anyone can download. Nothing about the app itself changed in this
release; what changed is that a tag now produces a public artifact instead of a
temporary one.

### Added

- **A published release** — a tag runs the package job, then publishes a public GitHub
  Release with `OpenMonkey-arm64.dmg`, the updater zip, their block maps and
  `latest-mac.yml`. The release notes are kept in the repository and carry the SHA-256
  of every file built.
- **Download links that keep working** — artifacts are named by architecture and not by
  version, so `releases/latest/download/OpenMonkey-arm64.dmg` is a permanent link. The
  landing page and README point straight at the disk image.
- **The product site is online** — `landing/` publishes to GitHub Pages from `main`.
- Several chats open in one window at once, each keeping its own thread, restored with
  the window (0.9.0 shipped the code; this is the release that carries it).
- `scripts/make-update-manifest.mjs` rebuilds the macOS update manifest from the
  archives actually on disk, so it is correct whichever arches reach a release.

### Fixed

- The CI `verify` and `package` jobs waited on Apple's retired Intel runner, which never
  answers; every run sat queued for a day and was then cancelled. Both jobs build on
  Apple Silicon now, and an Intel or Windows installer is stated as absent rather than
  implied.
- The landing page promised a Windows installer and an Intel build that no pipeline
  produced.

### Known limits

The release is unsigned: there is no Apple Developer ID behind it, so Gatekeeper
questions the first launch and the in-app updater can report a new version but cannot
install one. Both are settled by the certificate, not by code — the package job already
reads the five Apple secrets.

## 0.9.0 — 2026-10-30

The release-candidate build: local chat with tools, approvals, memory, privacy
controls and a desktop shell that can be installed and updated.

### Added

- **Chat** — streaming replies from a local model, conversation sessions with search,
  pin and rename, attachments, stop and retry, and failure states that say what
  happened.
- **Agent v2** — validated tool calls (files, web, shell, calendar/email), per-tool
  approval policies, a session-scoped "remember" choice, an audit log, and MCP
  servers.
- **Task monitor** — live tasks with moods, a command rail and an approval dialog that
  owns the decision; a fenced `task` block in a reply is parsed, repaired when a
  closing brace is doubled, and audited.
- **Memory** — cross-chat summaries, pinned facts, and optional local workspace
  retrieval with citations.
- **Desktop** — Quick Ask popover on Option+Space with inline approvals, launch at
  login, close-to-tray, native menu, notifications, Dock badge, window-state restore.
- **Appearance** — warm-gray and mint design tokens, 12 mood portraits wired to the
  window, tray and Dock, theme previews, text scale, density, contrast, reduced
  motion.
- **Localization and accessibility** — full EN/RU interface, named controls, landmark
  structure, live regions, focus handling; verified in an automated a11y audit.
- **Privacy** — AES-256-GCM history sealed by a Keychain key (0600 file fallback),
  optional scrypt passphrase lock with idle/sleep auto-lock, erase-everything,
  encrypted backup export/import with schema stamps, 7–365-day retention, a
  deny-all-network switch, and rotating logs that redact conversation text.
- **Release engineering** — unit (34) and integration (20) suites on `node:test`,
  Playwright e2e on a throwaway profile with a committed visual baseline, performance
  budgets (cold start, streaming jank, memory, lazy settings chunk), GitHub Actions
  verification matrix and tag packaging, hardened-runtime entitlements, and
  `electron-updater` with stable/beta channels.

### Fixed

- Mood portraits failed to load in packaged builds because their URLs were rooted at
  `/logos/…` under `file://`; all renderer asset paths are now document-relative, and
  the e2e a11y audit fails on any image that does not decode.
- A model reply that closed a task fence with an extra `}` no longer fails as invalid
  JSON; only surplus trailing braces are repaired, and the repair is logged.
- The Privacy toggle no longer accepts a second click while a re-encryption is in
  flight, which could queue a flip against a stale snapshot.
- The integration suite no longer flakes on a fake home without `Documents`: the
  runner creates the allowed folders before the shell tests and kills a stuck child
  after two minutes.

### Performance

- Settings loads as its own 132 kB chunk instead of inflating the 780 kB entry bundle.
- Streamed tokens coalesce into one render per animation frame: a 320-token stream
  kept zero long tasks and a 17.7 ms maximum frame gap.
- The model-load card counts elapsed seconds so a slow load never looks frozen.

### Known limitations

- The updater, signed packaging and notarization have not run end to end: there is no
  release feed or Developer ID certificate in this checkout, and unpackaged builds
  skip updates by design.
- Apple's MLX backend is optional and requires a separate Python environment; the
  GGUF backend is the default.
- A forgotten passphrase cannot be recovered.
