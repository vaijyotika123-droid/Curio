
--------------------------------------------------------------------------------
-- MIGRATION 008: LEARNING SECURITY AND DEDUPLICATION
--
-- 1. Separate quiz answers from publicly readable questions.
-- 2. Restrict authenticated quiz access to approved columns.
-- 3. Prevent duplicate quiz generation.
-- 4. Prevent duplicate connection outputs.
--------------------------------------------------------------------------------


--------------------------------------------------------------------------------
-- 1. ADD SECURE QUIZ ANSWER STORAGE
--------------------------------------------------------------------------------

-- Existing quizzes table is empty, so no backfill is required.
-- No default is intentionally provided: new quiz creation must supply an answer key.

ALTER TABLE public.quizzes
ADD COLUMN answer_key JSONB NOT NULL;

ALTER TABLE public.quizzes
ADD CONSTRAINT chk_quizzes_answer_key_object
CHECK (
    jsonb_typeof(answer_key) = 'object'
    AND answer_key <> '{}'::jsonb
);


--------------------------------------------------------------------------------
-- 2. RESTRICT AUTHENTICATED QUIZ COLUMN ACCESS
--------------------------------------------------------------------------------

-- Remove table-level SELECT access, including any inherited PUBLIC access.

REVOKE SELECT ON public.quizzes
FROM PUBLIC, anon, authenticated;

-- Grant access only to the nine approved columns.

GRANT SELECT (
    id,
    user_id,
    resource_id,
    question_set,
    input_fingerprint,
    model_provider,
    model_name,
    prompt_version,
    created_at
)
ON public.quizzes
TO authenticated;


--------------------------------------------------------------------------------
-- 3. PREVENT DUPLICATE QUIZZES
--------------------------------------------------------------------------------

-- A quiz is unique for a user, resource and generation fingerprint.
-- A changed resource version or generation configuration can produce a new quiz.

CREATE UNIQUE INDEX uq_quizzes_user_resource_fingerprint
ON public.quizzes (
    user_id,
    resource_id,
    input_fingerprint
);


--------------------------------------------------------------------------------
-- 4. PREVENT DUPLICATE CONNECTION OUTPUTS
--------------------------------------------------------------------------------

-- Only connection outputs are subject to this uniqueness rule.
-- Other AI output types remain unaffected.

CREATE UNIQUE INDEX uq_ai_outputs_connection_fingerprint
ON public.ai_outputs (
    user_id,
    input_fingerprint
)
WHERE feature_type = 'connection';


--------------------------------------------------------------------------------
-- END MIGRATION 008
--------------------------------------------------------------------------------
