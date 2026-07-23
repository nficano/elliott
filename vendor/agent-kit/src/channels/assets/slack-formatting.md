# Slack Platform — Formatting & Messaging for Agents

> What an app/agent can use to format output in Slack. Slack has TWO formatting systems:
> (1) `mrkdwn`, Slack's own markup (NOT standard Markdown), used in plain message text
> and mrkdwn text objects; and (2) Block Kit, a JSON layout system of "blocks" that
> composes rich, interactive messages and surfaces (modals, App Home). Prefer Block Kit
> for anything beyond a simple line of text.

## Docs

- [AI apps and agents](https://docs.slack.dev/ai.md): Build agentic experiences with streaming, thinking steps, and assistant surfaces.
- [Messaging](https://docs.slack.dev/messaging.md): Send, format, and manage messages.
- [Block Kit](https://docs.slack.dev/block-kit.md): Compose rich, interactive message and surface layouts.
- [Surfaces](https://docs.slack.dev/surfaces.md): App Home, modals, and other places your app appears.
- [Interactivity](https://docs.slack.dev/interactivity/handling-user-interaction.md): Handle buttons, menus, shortcuts, and other user interactions.
- [AI-assisted development](https://docs.slack.dev/ai/build-with-ai.md): How to give AI coding tools better context about the Slack platform.
- [Slack MCP server](https://docs.slack.dev/ai/slack-mcp-server.md): Give an AI tool direct access to your Slack workspace data.

## 1. mrkdwn — Slack's text markup

Used in: `text` field of chat.postMessage (when not using blocks), `mrkdwn` text
objects inside section/context blocks.

Syntax (note: differs from standard Markdown!):
- *bold*            → SINGLE asterisks (not **double**)
- _italic_          → single underscores
- ~strikethrough~
- `inline code`
- ```code block```  → no syntax-highlighting language tag support
- > blockquote      → one > per line
- Line breaks: literal \n
- Links: <https://example.com|display text>  (NOT [text](url))
- Emoji: :tada: :white_check_mark:
- User mention: <@U024BE7LH>
- Channel link: <#C024BE7CL>
- Usergroup: <!subteam^ID>
- Special mentions: <!here> <!channel> <!everyone>
- Date formatting (localized per viewer):
  <!date^1622559600^{date_short} at {time}|Jun 1 2021 at 12:00 PM>

NOT supported in mrkdwn (do not emit these):
- **double-asterisk bold**, [markdown](links), # headings, tables,
  native ordered/bulleted lists (use literal "•" / "1." text or rich_text lists),
  images-in-text, HTML.
Escape literal & < > as &amp; &lt; &gt;.

## 2. Block Kit — structured layouts

Messages: up to 50 blocks. Modals & App Home: up to 100 blocks.
Always also set a fallback `text` field on messages for notifications.

Layout blocks:
- `section`  — workhorse block; mrkdwn or plain_text, up to 10 `fields`
  (two-column layout), plus one optional accessory element (button, select, image…)
- `rich_text` — WYSIWYG-fidelity text: rich_text_section, rich_text_list
  (bullet/ordered, the ONLY real lists in Slack), rich_text_quote,
  rich_text_preformatted; supports bold/italic/strike/code/link/emoji/mention elements
- `header`   — large plain_text heading (max 150 chars)
- `context`  — small grey text and/or tiny images (up to 10 elements)
- `divider`  — horizontal rule
- `image`    — image by URL or Slack file, with alt_text
- `video`    — embedded video
- `actions`  — row of up to 25 interactive elements
- `input`    — labeled input (modals, Home, and messages)
- `file`, `markdown` (a newer block accepting standard markdown text — check current
  docs for availability), `table` (newer; check availability)

Text objects: { "type": "plain_text" | "mrkdwn", "text": "...", "emoji": true }.
plain_text renders literally; mrkdwn parses the syntax in section 1.

Interactive elements (in `actions`, `input`, or section accessory):
- button (styles: default, `primary` green, `danger` red; can confirm-dialog or open URL)
- static_select / external_select / users_select / conversations_select / channels_select
- multi_select variants of the above
- overflow menu, datepicker, timepicker, datetimepicker,
  checkboxes, radio_buttons, plain_text_input, number_input, email/url inputs,
  rich_text_input, file_input
Interactions arrive as payloads to your app (see Interactivity doc); respond via
response_url, views.update, etc.

## 3. Surfaces

- Messages (channels, DMs, threads) — chat.postMessage / chat.update; ephemeral via
  chat.postEphemeral.
- Modals — views.open / views.push / views.update; input blocks + submit.
- App Home — views.publish on the `home` tab.
- Assistant/AI split-view surface — thread-based pane for AI apps (see below).

## 4. AI apps & agents (assistant surface)

- Enable the Agents & AI Apps feature; handle `assistant_thread_started`,
  `assistant_thread_context_changed`, and `message.im` events.
- Set status while thinking: assistant.threads.setStatus ("is thinking…").
- Suggested prompts: assistant.threads.setSuggestedPrompts.
- Streaming responses: chat.startStream → chat.appendStream → chat.stopStream
  (token-by-token output; supports markdown-style text in the AI surface).
- Bolt SDKs ship an Assistant middleware class that wraps these.

## Practical guidance for agents

- Decide per message: simple one-liner → plain `text` with mrkdwn; anything
  structured → `blocks`, with fallback `text`.
- Never emit **bold** or [links](url) — use *bold* and <url|text>.
- For bulleted/numbered lists, use a `rich_text` block with `rich_text_list`;
  faking lists with "-" in mrkdwn works but doesn't render as a true list.
- Headings: use a `header` block (or *bold* line inside a section).
- Code with long output: ``` blocks have no highlighting; consider a file upload
  (files.uploadV2) with a snippet for large content.
- Field limits worth knowing: section text ≤ 3000 chars, header ≤ 150,
  button text ≤ 75, message `text` ≤ 40,000 (4,000 shown), ≤ 50 blocks/message.
- Validate layouts in Block Kit Builder: https://app.slack.com/block-kit-builder

## Optional

- [Formatting reference](https://docs.slack.dev/messaging/formatting-message-text): full mrkdwn spec
- [Block reference](https://docs.slack.dev/reference/block-kit/blocks): every block's JSON schema
- [Block elements reference](https://docs.slack.dev/reference/block-kit/block-elements): interactive elements
- [Composition objects](https://docs.slack.dev/reference/block-kit/composition-objects): text, confirm, option objects
