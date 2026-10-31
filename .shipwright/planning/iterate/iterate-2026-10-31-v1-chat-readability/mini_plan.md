# Mini-plan V1 chat readability (already implemented in working tree)
1. FeedCard: render textFull/explanationFull/answerFull directly; drop ExpandToggle on those. Keep toggle for card.detail (raw tool output) and command chips.
2. MissionActivityFeed: data-switch="true" on an entry when speaker (user vs non-user) changes.
3. mission-chat.css: scale tokens (--fs-chat 15, --fs-small 13, --fs-eyebrow 12, --gap-turn 28, --gap-switch 36, --gap-block 12), nothing below 12px, link teal+underline, table skin.
4. mission-operation.css dark scope: --body #d9d6d0, --muted #a9a39b, --faint #8f8981, --link #7fdcca, --thead #2d2a28.
5. MarkdownText: table renderer wraps in div.mc-table-wrap (white header came from index.css .markdown-body table th --color-muted-bg).
6. Tests: updated card tests, new mission-chat-scale.test.ts (contrast/floor/tokens).
