# DB Service restore creates a new DB Service

DB Service Restore creates a new DB Service from the selected DB Service Backup instead of overwriting or rolling back the source DB Service. This keeps restore non-destructive and lets users inspect or migrate from the restored service without risking the live source data, at the cost of producing an additional DB Service on the same Project Canvas and namespace that users may later clean up.
