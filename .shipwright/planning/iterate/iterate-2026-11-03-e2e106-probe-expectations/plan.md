Goal: Spec 106 is green again - terminal file links are tappable on the first tap on a phone, and the spec asserts the post-#565 behaviour for an unevidenced outside path
Reason: #565 made the link provider wait for the async probe; touch taps have no hover so the first tap found no link (real regression), and the unevidenced-outside test expected the pre-#565 notice (stale expectation)
Reference: Sven request 2026-11-03 (spec 106 two failures on main fd818c95)
