# Architecture brief V1
Problem: Mission chat truncates agent/user messages behind "Show more", has tight spacing/small type, white GFM table headers on the dark card, and browser-default blue links.
Options: (A) do nothing; (B) CSS + small TSX changes in the existing feed (chosen scope); (C) a new chat renderer component.
Smallest change: B. No new permanent mechanism besides a table wrapper element in the shared markdown renderer (no style effect outside .mc-feed-card).
