# Compact Today task list - 2026-10-17

Today view no longer reserves a64px left time column or inserts dash placeholders. Checkbox and title sit10px apart. Planned time appears as the existing green metadata pill, deadlines retain their deadline label. A redundant today pill is omitted for untimed tasks. Row padding6px, minimum48px; checkbox44px hit target retained. Only Today rows use compactDay; ordering, completion and task data are unchanged.

Verification: syntax, UI12/12, ios:sync16 passed. Browser390x844 light theme: no horizontal overflow, title area290px, rows54-76px on fixtures, no time-column nodes. Long names wrap; completed titles remain struck out. Opening scheduled task preserved15:00. Preview outputs/MARK-today-compact.png uses synthetic data. Native output public assets updated. Final real-device acceptance pending.

Final Xcode status confirmed: Running App on iPhone KIRILL MARK with both changes.
