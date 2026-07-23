# Telegram Styled Text & Message Entities

> How to format text in Telegram messages. Telegram represents styling as a list of
> `MessageEntity` objects attached to plain text. Bots and clients can either construct
> entities directly, or write Markdown/HTML and let the API parse it into entities
> (`parse_mode` in the Bot API). Offsets and lengths are counted in UTF-16 code units.
> Source: https://core.telegram.org/api/entities

## Core concepts

- Every styled message = plain text string + array of entities `{ type, offset, length, ...extra }`.
- `offset`/`length` are in **UTF-16 code units**, not bytes or Unicode code points.
  Emoji and other astral-plane characters count as 2 units.
- Entities may overlap/nest (e.g. bold inside italic), except where noted below.
- Two ways to produce entities:
  1. Send raw text + explicit `entities` array (full control, no escaping headaches).
  2. Send formatted text with `parse_mode` = `MarkdownV2` or `HTML` (Bot API parses it).
     Legacy `Markdown` mode exists but is deprecated and less capable — avoid it.

## Entity types (MessageEntity)

Styling entities you can set yourself:

- `bold` — bold text
- `italic` — italic text
- `underline` — underlined text
- `strikethrough` — struck-through text
- `spoiler` — hidden until tapped
- `code` — inline fixed-width
- `pre` — fixed-width block; optional `language` field for syntax highlighting
- `blockquote` — block quotation; may be `expandable`/collapsed by default
- `text_link` — clickable text pointing to a URL (`url` field)
- `text_mention` — mention of a user without a username (`user` field / user id)
- `custom_emoji` — custom emoji by `custom_emoji_id` (requires the emoji's document id;
  bots need appropriate access, e.g. Fragment-purchased usernames or paid subscriptions
  for arbitrary custom emoji)

Entities Telegram detects automatically in plain text (you normally don't set these):

- `mention` (@username), `hashtag` (#tag), `cashtag` ($USD), `bot_command` (/start),
  `url`, `email`, `phone_number`, `bank_card`

## MarkdownV2 syntax (parse_mode=MarkdownV2)

*bold text*
_italic text_
__underline__
~strikethrough~
||spoiler||
`inline code`
```python
pre-formatted code block with optional language
```
[inline link](https://example.com)
[inline user mention](tg://user?id=123456789)
![custom emoji](tg://emoji?id=5368324170671202286)
>Blockquote line 1
>Blockquote line 2
**>Expandable blockquote line 1
>Expandable blockquote line 2||   (the closing || marks the end / collapsed state)

Rules & gotchas:
- These characters MUST be escaped with a preceding '\' anywhere they appear as
  literal text: _ * [ ] ( ) ~ ` > # + - = | { } . !
  (Inside `code`/`pre`, only ` and \ need escaping; inside link/emoji URLs, only ) and \.)
- Ambiguity between italic and underline: use \r between them, e.g.
  __underline _italic\r__ underline__ — or just use explicit entities/HTML.
- Entities must not overlap in Markdown mode (proper nesting only).
- There are NO headings, tables, bullet/numbered lists, images, or horizontal rules.
  Simulate lists with plain "•" or "1." text; simulate headings with bold lines.

## HTML syntax (parse_mode=HTML)

<b>bold</b>, <strong>bold</strong>
<i>italic</i>, <em>italic</em>
<u>underline</u>, <ins>underline</ins>
<s>strike</s>, <strike>strike</strike>, <del>strike</del>
<tg-spoiler>spoiler</tg-spoiler> or <span class="tg-spoiler">spoiler</span>
<code>inline code</code>
<pre>block</pre>
<pre><code class="language-python">highlighted block</code></pre>
<a href="https://example.com">link</a>
<a href="tg://user?id=123456789">user mention</a>
<tg-emoji emoji-id="5368324170671202286">🎉</tg-emoji>
<blockquote>quote</blockquote>
<blockquote expandable>collapsed quote</blockquote>

Rules & gotchas:
- Only the tags above are supported. All other tags are rejected, not ignored.
- Escape literal < > & as &lt; &gt; &amp; (and use &quot; in attribute values).
- Nesting is allowed (e.g. <b><i>bold italic</i></b>).
- HTML is often the safer choice for programmatic generation: only 3 characters
  need escaping vs. 18 in MarkdownV2.

## Practical guidance for agents

- Prefer HTML parse mode or explicit entity arrays when generating text
  programmatically; MarkdownV2 escaping is error-prone.
- Never emit GitHub-style markdown (## headings, - lists, tables, **bold**) —
  Telegram does not support it and MarkdownV2 will error on unescaped characters.
- In MarkdownV2, *single asterisks* = bold and _single underscores_ = italic
  (unlike CommonMark).
- Keep entity offsets in UTF-16 code units when constructing entities manually.
- Max message length: 4096 UTF-8 characters (1024 for media captions); split long
  output across messages without breaking inside an entity.

## Related docs

- Bot API formatting options: https://core.telegram.org/bots/api#formatting-options
- MessageEntity object: https://core.telegram.org/bots/api#messageentity
- MTProto styled text: https://core.telegram.org/api/entities
