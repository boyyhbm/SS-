# NEXUS Railway

`.railway/railway.ts` uses the current Railway IaC API (`railway` SDK 3.16.0, CLI >=5.42.1). It does not execute on import or create resources during CI. Legacy `railway.json` configuration is deprecated for new services.

Read [the production runbook](../docs/railway-production.md) before planning/applying. The initial bootstrap leaves Web and Multiplayer without a source deployment so existing data can be imported before launch. A live `apply` creates billable resources; obtain the owner's cost approval first.

Do not put Railway tokens, secret values, backups, generated plans containing credentials, or linked CLI state into Git. Keep the database and volume resources in this file when updating the app. Use GitHub autodeploys for code updates; infrastructure changes require a separate reviewed plan.
