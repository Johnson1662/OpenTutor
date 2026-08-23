# 0001. Protocol-First and Domain Service Architecture

OpenTutor client (Web / future ArkUI), Agent Runtime (Pi SDK), and Server communicate strictly through shared typed definitions in `@opentutor/protocol`. We isolate the Agent from directly manipulating the database or rendering freeform HTML by enforcing all AI actions to route through typed Domain Tools (`lesson_patch`, `path_patch`, `assessment_record`) and versioned Domain Services.
