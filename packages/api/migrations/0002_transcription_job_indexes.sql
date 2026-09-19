-- Keep active-job polling and recording lookups bounded to matching jobs.
CREATE INDEX IF NOT EXISTS idx_jobs_status_created
  ON transcription_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_recording_created
  ON transcription_jobs(recording_id, created_at DESC);
