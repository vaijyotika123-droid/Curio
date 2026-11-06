--------------------------------------------------------------------------------
-- 9. QUIZZES
--------------------------------------------------------------------------------
CREATE TABLE public.quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    resource_id UUID NOT NULL,
    question_set JSONB NOT NULL,
    input_fingerprint TEXT NOT NULL CHECK (length(trim(input_fingerprint)) > 0),
    model_provider TEXT NOT NULL CHECK (length(trim(model_provider)) > 0),
    model_name TEXT NOT NULL CHECK (length(trim(model_name)) > 0),
    prompt_version TEXT NOT NULL CHECK (length(trim(prompt_version)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_quizzes_id_user_id UNIQUE (id, user_id),
    CONSTRAINT fk_quizzes_resource FOREIGN KEY (resource_id, user_id)
        REFERENCES public.resources (id, user_id) ON DELETE CASCADE
);

CREATE INDEX idx_quizzes_resource ON public.quizzes (resource_id, created_at DESC);

--------------------------------------------------------------------------------
-- 10. QUIZ_ATTEMPTS
--------------------------------------------------------------------------------
CREATE TABLE public.quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    quiz_id UUID NOT NULL,
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
    total_questions INTEGER NOT NULL CHECK (total_questions > 0),
    status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
    started_at TIMESTAMPTZ NOT NULL,
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_quiz_attempts_score CHECK (score <= total_questions),
    CONSTRAINT chk_quiz_attempts_completion CHECK (
        (status = 'completed' AND submitted_at IS NOT NULL AND submitted_at >= started_at) OR
        (status = 'in_progress' AND submitted_at IS NULL AND score = 0)
    ),
    -- One attempt record per user per quiz in MVP
    CONSTRAINT uq_quiz_attempts_quiz_user UNIQUE (quiz_id, user_id),
    CONSTRAINT fk_quiz_attempts_quiz FOREIGN KEY (quiz_id, user_id)
        REFERENCES public.quizzes (id, user_id) ON DELETE CASCADE
);

--------------------------------------------------------------------------------
-- 11. CHALLENGE_SESSIONS
--------------------------------------------------------------------------------
CREATE TABLE public.challenge_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    challenge_type TEXT NOT NULL CHECK (challenge_type IN ('connect', 'challenge', 'apply')),
    topic_id UUID,
    status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    challenge_context JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_challenge_sessions_id_user_id UNIQUE (id, user_id),
    -- PostgreSQL 15+ Native Composite FK with ON DELETE SET NULL (topic_id)
    -- Preserves user_id while setting topic_id to NULL when parent topic is deleted
    CONSTRAINT fk_challenge_sessions_topic FOREIGN KEY (topic_id, user_id)
        REFERENCES public.topics (id, user_id) ON DELETE SET NULL (topic_id),
    CONSTRAINT chk_challenge_sessions_completion CHECK (
        (status = 'completed' AND completed_at IS NOT NULL AND completed_at >= created_at) OR
        (status IN ('in_progress', 'abandoned') AND completed_at IS NULL)
    )
);

CREATE INDEX idx_challenge_sessions_user ON public.challenge_sessions (user_id, status, created_at DESC);

--------------------------------------------------------------------------------
-- 12. CHALLENGE_RESPONSES
--------------------------------------------------------------------------------
CREATE TABLE public.challenge_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    user_id UUID NOT NULL,
    question_id TEXT NOT NULL CHECK (length(trim(question_id)) > 0),
    question_order INTEGER NOT NULL CHECK (question_order >= 0),
    user_response JSONB,
    ai_feedback JSONB,
    status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'evaluated')),
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_challenge_responses_session_question UNIQUE (session_id, question_id),
    CONSTRAINT fk_challenge_responses_session FOREIGN KEY (session_id, user_id)
        REFERENCES public.challenge_sessions (id, user_id) ON DELETE CASCADE,
    CONSTRAINT chk_challenge_responses_submission CHECK (
    (status = 'pending' AND submitted_at IS NULL AND ai_feedback IS NULL) OR
    (status = 'submitted' AND user_response IS NOT NULL AND submitted_at IS NOT NULL AND submitted_at >= created_at AND ai_feedback IS NULL) OR
    (status = 'evaluated' AND user_response IS NOT NULL AND submitted_at IS NOT NULL AND submitted_at >= created_at AND ai_feedback IS NOT NULL)
)
);

CREATE INDEX idx_challenge_responses_order ON public.challenge_responses (session_id, question_order);

--------------------------------------------------------------------------------
-- 13. CHALLENGE_SESSION_RESOURCES
--------------------------------------------------------------------------------
CREATE TABLE public.challenge_session_resources (
    session_id UUID NOT NULL,
    resource_id UUID NOT NULL,
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (session_id, resource_id),

    CONSTRAINT fk_challenge_session_resources_session FOREIGN KEY (session_id, user_id)
        REFERENCES public.challenge_sessions (id, user_id) ON DELETE CASCADE,
    CONSTRAINT fk_challenge_session_resources_resource FOREIGN KEY (resource_id, user_id)
        REFERENCES public.resources (id, user_id) ON DELETE CASCADE
);

CREATE INDEX idx_challenge_session_resources_lookup ON public.challenge_session_resources (resource_id, session_id);
