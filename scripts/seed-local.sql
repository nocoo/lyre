-- Local wrangler --env test D1 seed for the E2E skip-auth user.
-- Re-runnable. Apply:
--   sqlite3 apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite < scripts/seed-local.sql
-- or from apps/api:
--   wrangler d1 execute lyre-db-test --env test --local --file ../../scripts/seed-local.sql

INSERT OR IGNORE INTO users (id, email, name, avatar_url, created_at, updated_at)
VALUES ('e2e-test-user', 'e2e@test.com', 'E2E Test User', NULL, 1785844800000, 1785844800000);

DELETE FROM recording_tags WHERE recording_id LIKE 'seed-%';
DELETE FROM transcriptions WHERE id LIKE 'seed-%';
DELETE FROM transcription_jobs WHERE id LIKE 'seed-%';
DELETE FROM recordings WHERE id LIKE 'seed-%';
DELETE FROM tags WHERE id LIKE 'seed-%';
DELETE FROM folders WHERE id LIKE 'seed-%';

INSERT INTO folders (id, user_id, name, icon, created_at, updated_at) VALUES
  ('seed-folder-meetings', 'e2e-test-user', 'Meetings', 'briefcase', 1772884800000, 1772884800000),
  ('seed-folder-interviews', 'e2e-test-user', 'Interviews', 'headphones', 1775476800000, 1775476800000),
  ('seed-folder-standups', 'e2e-test-user', 'Standups', 'star', 1778068800000, 1778068800000),
  ('seed-folder-podcasts', 'e2e-test-user', 'Podcasts', 'radio', 1780660800000, 1780660800000);

INSERT INTO tags (id, user_id, name, created_at) VALUES
  ('seed-tag-meeting', 'e2e-test-user', 'meeting', 1772884800000),
  ('seed-tag-product', 'e2e-test-user', 'product', 1772884800000),
  ('seed-tag-design', 'e2e-test-user', 'design', 1775476800000),
  ('seed-tag-interview', 'e2e-test-user', 'interview', 1778068800000),
  ('seed-tag-customer', 'e2e-test-user', 'customer', 1778068800000),
  ('seed-tag-standup', 'e2e-test-user', 'standup', 1780660800000),
  ('seed-tag-podcast', 'e2e-test-user', 'podcast', 1783252800000),
  ('seed-tag-chinese', 'e2e-test-user', '中文', 1784548800000);

INSERT INTO recordings (
  id, user_id, folder_id, title, description, file_name, file_size, duration, format, sample_rate,
  oss_key, tags, notes, ai_summary, ai_summary_status, ai_summary_error, recorded_at, status, created_at, updated_at
) VALUES
  (
    'seed-rec-q4-review', 'e2e-test-user', 'seed-folder-meetings',
    'Q4 Product Review Meeting',
    'Quarterly review covering user growth, retention, and infrastructure.',
    'q4-product-review.m4a', 15728640, 1847.5, 'm4a', 48000,
    'uploads/e2e-test-user/seed-rec-q4-review/q4-product-review.m4a', '[]',
    'Key takeaway: 23% MAU growth, 68% D30 retention.',
    'Quarterly review covering 23% MAU growth, mobile retention at 68% D30, and a completed database cluster migration. Next steps: scale infra and lock Q1 targets.',
    'succeeded', NULL, 1772884800000, 'completed', 1772884800000, 1772884800000
  ),
  (
    'seed-rec-design-sprint', 'e2e-test-user', 'seed-folder-meetings',
    'Design Sprint Kickoff',
    'Brainstorming for the dashboard redesign.',
    'design-sprint-kickoff.mp3', 8912345, 1023.2, 'mp3', 44100,
    'uploads/e2e-test-user/seed-rec-design-sprint/design-sprint-kickoff.mp3', '[]',
    NULL,
    'Kickoff for the dashboard redesign. Ideas: simpler nav, stronger charts, mobile-first layout.',
    'succeeded', NULL, 1775476800000, 'completed', 1775476800000, 1775476800000
  ),
  (
    'seed-rec-1on1', 'e2e-test-user', 'seed-folder-meetings',
    '1:1 with Alex — Career Path',
    'Career conversation and promotion packet notes.',
    '1on1-alex.m4a', 6230012, 742.0, 'm4a', 48000,
    'uploads/e2e-test-user/seed-rec-1on1/1on1-alex.m4a', '[]',
    'Follow up on the writing sample.',
    NULL, 'running', NULL, 1783252800000, 'completed', 1783252800000, 1783252800000
  ),
  (
    'seed-rec-retro', 'e2e-test-user', 'seed-folder-meetings',
    'Sprint 42 Retro',
    'What went well, what to change.',
    'sprint-42-retro.wav', 22100321, 1988.4, 'wav', 48000,
    'uploads/e2e-test-user/seed-rec-retro/sprint-42-retro.wav', '[]',
    NULL,
    NULL, 'failed', 'AI provider timed out after 60s', 1784548800000, 'completed', 1784548800000, 1784548800000
  ),
  (
    'seed-rec-acme', 'e2e-test-user', 'seed-folder-interviews',
    'Customer Interview — Acme Corp',
    'Discovery call with Acme engineering lead.',
    'acme-interview.mp3', 22456789, 2756.8, 'mp3', 48000,
    'uploads/e2e-test-user/seed-rec-acme/acme-interview.mp3', '[]',
    NULL,
    'Acme wants faster exports and SSO. Pain: weekly CSV dance. Champion is the eng lead.',
    'succeeded', NULL, 1778068800000, 'completed', 1778068800000, 1778068800000
  ),
  (
    'seed-rec-zh-standup', 'e2e-test-user', 'seed-folder-standups',
    '早会 9月2日',
    '中文站会录音，用来看逐词高亮。',
    'standup-zh.m4a', 4120000, 512.0, 'm4a', 48000,
    'uploads/e2e-test-user/seed-rec-zh-standup/standup-zh.m4a', '[]',
    '记得把发布窗口改到周四。',
    '站会同步了发布窗口、缺陷数和本周人力。结论：周四发版，缺陷先清 P0。',
    'succeeded', NULL, 1788350400000, 'completed', 1788350400000, 1788350400000
  ),
  (
    'seed-rec-standup-feb', 'e2e-test-user', 'seed-folder-standups',
    'Team Standup — Aug 12',
    NULL,
    'standup-aug12.mp3', 3456789, 412.0, 'mp3', 44100,
    'uploads/e2e-test-user/seed-rec-standup-feb/standup-aug12.mp3', '[]',
    NULL, NULL, NULL, NULL, 1780660800000, 'completed', 1780660800000, 1780660800000
  ),
  (
    'seed-rec-podcast', 'e2e-test-user', 'seed-folder-podcasts',
    'Podcast Episode 12 Draft',
    'Raw recording on developer productivity.',
    'podcast-ep12-raw.mp3', 45678901, 5234.6, 'mp3', 48000,
    'uploads/e2e-test-user/seed-rec-podcast/podcast-ep12-raw.mp3', '[]',
    'Need to re-record the intro.',
    NULL, NULL, NULL, 1785844800000, 'failed', 1785844800000, 1785844800000
  ),
  (
    'seed-rec-transcribing-a', 'e2e-test-user', 'seed-folder-meetings',
    'All-hands September',
    'Company all-hands, still in transcription.',
    'allhands-sep.m4a', 31200000, 3612.0, 'm4a', 48000,
    'uploads/e2e-test-user/seed-rec-transcribing-a/allhands-sep.m4a', '[]',
    NULL, NULL, NULL, NULL, 1788177600000, 'transcribing', 1788177600000, 1788177600000
  ),
  (
    'seed-rec-transcribing-b', 'e2e-test-user', NULL,
    'Office hours with support',
    NULL,
    'office-hours.wav', 9800000, 890.2, 'wav', 44100,
    'uploads/e2e-test-user/seed-rec-transcribing-b/office-hours.wav', '[]',
    NULL, NULL, NULL, NULL, 1788264000000, 'transcribing', 1788264000000, 1788264000000
  ),
  (
    'seed-rec-uploaded-a', 'e2e-test-user', 'seed-folder-interviews',
    'Candidate screen — Frontend',
    'Just uploaded, not transcribed yet.',
    'screen-frontend.m4a', 5400000, 633.0, 'm4a', 48000,
    'uploads/e2e-test-user/seed-rec-uploaded-a/screen-frontend.m4a', '[]',
    NULL, NULL, NULL, NULL, 1788436800000, 'uploaded', 1788436800000, 1788436800000
  ),
  (
    'seed-rec-uploaded-b', 'e2e-test-user', NULL,
    'Voice memo — grocery ideas',
    NULL,
    'memo-grocery.mp3', 890000, 95.4, 'mp3', 44100,
    'uploads/e2e-test-user/seed-rec-uploaded-b/memo-grocery.mp3', '[]',
    'Unfiled on purpose.',
    NULL, NULL, NULL, 1788436800000, 'uploaded', 1788436800000, 1788436800000
  ),
  (
    'seed-rec-failed-asr', 'e2e-test-user', NULL,
    'Noisy cafe capture',
    'ASR failed on this one.',
    'cafe-noise.m4a', 2100000, 188.0, 'm4a', 48000,
    'uploads/e2e-test-user/seed-rec-failed-asr/cafe-noise.m4a', '[]',
    NULL, NULL, NULL, NULL, 1787227200000, 'failed', 1787227200000, 1787227200000
  );

INSERT INTO transcription_jobs (
  id, recording_id, task_id, request_id, status, submit_time, end_time, usage_seconds,
  error_message, result_url, created_at, updated_at
) VALUES
  ('seed-job-q4', 'seed-rec-q4-review', 'mock-task-q4', 'req-q4', 'SUCCEEDED', '2026-03-06 12:00:00.000', '2026-03-06 12:02:35.000', 1848, NULL, 'https://mock-result.example.com/q4.json', 1772884800000, 1772884800000),
  ('seed-job-design', 'seed-rec-design-sprint', 'mock-task-design', 'req-design', 'SUCCEEDED', '2026-04-05 12:00:00.000', '2026-04-05 12:01:40.000', 1023, NULL, 'https://mock-result.example.com/design.json', 1775476800000, 1775476800000),
  ('seed-job-1on1', 'seed-rec-1on1', 'mock-task-1on1', 'req-1on1', 'SUCCEEDED', '2026-07-04 12:00:00.000', '2026-07-04 12:01:10.000', 742, NULL, 'https://mock-result.example.com/1on1.json', 1783252800000, 1783252800000),
  ('seed-job-retro', 'seed-rec-retro', 'mock-task-retro', 'req-retro', 'SUCCEEDED', '2026-07-19 12:00:00.000', '2026-07-19 12:03:00.000', 1988, NULL, 'https://mock-result.example.com/retro.json', 1784548800000, 1784548800000),
  ('seed-job-acme', 'seed-rec-acme', 'mock-task-acme', 'req-acme', 'SUCCEEDED', '2026-05-05 12:00:00.000', '2026-05-05 12:04:10.000', 2757, NULL, 'https://mock-result.example.com/acme.json', 1778068800000, 1778068800000),
  ('seed-job-zh', 'seed-rec-zh-standup', 'mock-task-zh', 'req-zh', 'SUCCEEDED', '2026-09-02 12:00:00.000', '2026-09-02 12:00:50.000', 512, NULL, 'https://mock-result.example.com/zh.json', 1788350400000, 1788350400000),
  ('seed-job-standup', 'seed-rec-standup-feb', 'mock-task-standup', 'req-standup', 'SUCCEEDED', '2026-06-04 12:00:00.000', '2026-06-04 12:00:40.000', 412, NULL, 'https://mock-result.example.com/standup.json', 1780660800000, 1780660800000),
  ('seed-job-podcast', 'seed-rec-podcast', 'mock-task-podcast', 'req-podcast', 'FAILED', '2026-08-04 12:00:00.000', '2026-08-04 12:00:12.000', NULL, 'Audio duration exceeds provider limit', NULL, 1785844800000, 1785844800000),
  ('seed-job-allhands', 'seed-rec-transcribing-a', 'mock-task-allhands', 'req-allhands', 'RUNNING', '2026-08-31 12:00:00.000', NULL, NULL, NULL, NULL, 1788177600000, 1788177600000),
  ('seed-job-office', 'seed-rec-transcribing-b', 'mock-task-office', 'req-office', 'PENDING', '2026-09-01 12:00:00.000', NULL, NULL, NULL, NULL, 1788264000000, 1788264000000),
  ('seed-job-cafe', 'seed-rec-failed-asr', 'mock-task-cafe', 'req-cafe', 'FAILED', '2026-08-20 12:00:00.000', '2026-08-20 12:00:08.000', NULL, 'No speech detected', NULL, 1787227200000, 1787227200000);

INSERT INTO transcriptions (id, recording_id, job_id, full_text, sentences, language, created_at, updated_at) VALUES
  (
    'seed-tx-q4', 'seed-rec-q4-review', 'seed-job-q4',
    'Welcome to the quarterly product review meeting. Today we will discuss growth, retention, and infrastructure. Monthly active users are up 23 percent. Day-30 retention reached 68 percent. The database cluster migration finished last week.',
    '[{"sentenceId":0,"channelId":0,"beginTime":0,"endTime":3200,"text":"Welcome to the quarterly product review meeting.","language":"en","emotion":"neutral"},{"sentenceId":1,"channelId":0,"beginTime":3200,"endTime":7800,"text":"Today we will discuss growth, retention, and infrastructure.","language":"en","emotion":"neutral"},{"sentenceId":2,"channelId":0,"beginTime":7800,"endTime":12400,"text":"Monthly active users are up 23 percent.","language":"en","emotion":"neutral"},{"sentenceId":3,"channelId":0,"beginTime":12400,"endTime":18200,"text":"Day-30 retention reached 68 percent.","language":"en","emotion":"neutral"},{"sentenceId":4,"channelId":0,"beginTime":18200,"endTime":23000,"text":"The database cluster migration finished last week.","language":"en","emotion":"neutral"}]',
    'en', 1772884800000, 1772884800000
  ),
  (
    'seed-tx-design', 'seed-rec-design-sprint', 'seed-job-design',
    'This kickoff is for the dashboard redesign sprint. We want simpler navigation and better charts. Mobile-first is non-negotiable this time.',
    '[{"sentenceId":0,"channelId":0,"beginTime":0,"endTime":2800,"text":"This kickoff is for the dashboard redesign sprint.","language":"en","emotion":"neutral"},{"sentenceId":1,"channelId":0,"beginTime":2800,"endTime":6400,"text":"We want simpler navigation and better charts.","language":"en","emotion":"neutral"},{"sentenceId":2,"channelId":0,"beginTime":6400,"endTime":9800,"text":"Mobile-first is non-negotiable this time.","language":"en","emotion":"neutral"}]',
    'en', 1775476800000, 1775476800000
  ),
  (
    'seed-tx-1on1', 'seed-rec-1on1', 'seed-job-1on1',
    'Let us talk about the promotion packet. The writing sample still needs a second pass. I can review a draft on Friday.',
    '[{"sentenceId":0,"channelId":0,"beginTime":0,"endTime":2600,"text":"Let us talk about the promotion packet.","language":"en","emotion":"neutral"},{"sentenceId":1,"channelId":0,"beginTime":2600,"endTime":6100,"text":"The writing sample still needs a second pass.","language":"en","emotion":"neutral"},{"sentenceId":2,"channelId":0,"beginTime":6100,"endTime":9000,"text":"I can review a draft on Friday.","language":"en","emotion":"neutral"}]',
    'en', 1783252800000, 1783252800000
  ),
  (
    'seed-tx-retro', 'seed-rec-retro', 'seed-job-retro',
    'What went well: pairing and the smaller PRs. What to change: the Friday deploy window keeps slipping.',
    '[{"sentenceId":0,"channelId":0,"beginTime":0,"endTime":3100,"text":"What went well: pairing and the smaller PRs.","language":"en","emotion":"neutral"},{"sentenceId":1,"channelId":0,"beginTime":3100,"endTime":7200,"text":"What to change: the Friday deploy window keeps slipping.","language":"en","emotion":"neutral"}]',
    'en', 1784548800000, 1784548800000
  ),
  (
    'seed-tx-acme', 'seed-rec-acme', 'seed-job-acme',
    'Our weekly export is still a CSV email. SSO would unblock three teams. Speed matters more than new charts right now.',
    '[{"sentenceId":0,"channelId":0,"beginTime":0,"endTime":2900,"text":"Our weekly export is still a CSV email.","language":"en","emotion":"neutral"},{"sentenceId":1,"channelId":0,"beginTime":2900,"endTime":5600,"text":"SSO would unblock three teams.","language":"en","emotion":"neutral"},{"sentenceId":2,"channelId":0,"beginTime":5600,"endTime":9100,"text":"Speed matters more than new charts right now.","language":"en","emotion":"neutral"}]',
    'en', 1778068800000, 1778068800000
  ),
  (
    'seed-tx-zh', 'seed-rec-zh-standup', 'seed-job-zh',
    '今天先对一下发布窗口。P0 缺陷还有两个。人力这周够用，周四发版。',
    '[{"sentenceId":0,"channelId":0,"beginTime":0,"endTime":2400,"text":"今天先对一下发布窗口。","language":"zh","emotion":"neutral"},{"sentenceId":1,"channelId":0,"beginTime":2400,"endTime":4800,"text":"P0 缺陷还有两个。","language":"zh","emotion":"neutral"},{"sentenceId":2,"channelId":0,"beginTime":4800,"endTime":7600,"text":"人力这周够用，周四发版。","language":"zh","emotion":"neutral"}]',
    'zh', 1788350400000, 1788350400000
  ),
  (
    'seed-tx-standup', 'seed-rec-standup-feb', 'seed-job-standup',
    'No blockers. Shipping the settings page today.',
    '[{"sentenceId":0,"channelId":0,"beginTime":0,"endTime":1800,"text":"No blockers.","language":"en","emotion":"neutral"},{"sentenceId":1,"channelId":0,"beginTime":1800,"endTime":4200,"text":"Shipping the settings page today.","language":"en","emotion":"neutral"}]',
    'en', 1780660800000, 1780660800000
  );

INSERT INTO recording_tags (recording_id, tag_id) VALUES
  ('seed-rec-q4-review', 'seed-tag-meeting'),
  ('seed-rec-q4-review', 'seed-tag-product'),
  ('seed-rec-design-sprint', 'seed-tag-design'),
  ('seed-rec-design-sprint', 'seed-tag-meeting'),
  ('seed-rec-1on1', 'seed-tag-meeting'),
  ('seed-rec-retro', 'seed-tag-meeting'),
  ('seed-rec-acme', 'seed-tag-interview'),
  ('seed-rec-acme', 'seed-tag-customer'),
  ('seed-rec-zh-standup', 'seed-tag-standup'),
  ('seed-rec-zh-standup', 'seed-tag-chinese'),
  ('seed-rec-standup-feb', 'seed-tag-standup'),
  ('seed-rec-podcast', 'seed-tag-podcast'),
  ('seed-rec-transcribing-a', 'seed-tag-meeting'),
  ('seed-rec-uploaded-a', 'seed-tag-interview');
