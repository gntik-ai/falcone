# fix-workspace-slug-conflict-409

Concurrent workspace-slug creates must return 409 WORKSPACE_SLUG_CONFLICT, never a raw 500/23505 (#634)
