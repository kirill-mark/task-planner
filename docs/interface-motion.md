# MARK interface motion - 2026-10-17

Final user clarification: soft loading-like reveal only on first entry into the app. Subsequent tab navigation enters from the right. Task sheets enter from below.

The first real #main screen (after auth/loading screens) reveals its content blocks in720ms with0/80/160ms capped stagger and10px upward settle. No synthetic loading timer. A navigation interrupts any unfinished launch reveal. Routine data renders resume remaining animation time. Reduced Motion skips animations and cleans exit layers.

Ordinary tabs: translateX36px to0 in680ms. Assistant: full-width right entry620ms; return snapshot exits right620ms while underlying main returns from-24px in480ms. Panels440ms and conversation switches400ms use right entry. Easing cubic-bezier(.3,.65,.25,1). Sheet open550ms/close420ms; scrim420ms/360ms. Closing starts from the actual animated pose; body scroll stays locked through dismissal. Snapshots inert and stripped of action/id/autofocus attributes.

Verification: JS syntax, UI12/12, ios:sync16. Browser390x844 recorded first-entry vertical reveal, subsequent Assistant translateX100%620ms, ordinary tabs translateX36px680ms, sheet translateY100%550ms. Evidence outputs/MARK-launch-navigation-evidence.json. Device acceptance of this final separation pending.

Final Xcode status confirmed: Running App on iPhone KIRILL MARK with both changes.
