
CREATE OR REPLACE FUNCTION public.create_quiz_with_attempt(
    p_user_id UUID,
    p_resource_id UUID,
    p_question_set JSONB,
    p_answer_key JSONB,
    p_total_questions INTEGER,
    p_input_fingerprint TEXT,
    p_model_provider TEXT,
    p_model_name TEXT,
    p_prompt_version TEXT
)
RETURNS TABLE (
    quiz_id UUID,
    attempt_id UUID,
    question_set JSONB,
    total_questions INTEGER,
    created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_quiz_id UUID;
    v_attempt_id UUID;
    v_question_set JSONB;
    v_created BOOLEAN := FALSE;
BEGIN
    -- Validate required IDs.
    IF p_user_id IS NULL OR p_resource_id IS NULL THEN
        RAISE EXCEPTION 'User ID and resource ID are required';
    END IF;

    -- Validate question set.
    IF p_question_set IS NULL THEN
        RAISE EXCEPTION 'Question set is required';
    END IF;

    IF jsonb_typeof(p_question_set) <> 'array' THEN
        RAISE EXCEPTION 'Question set must be a JSON array';
    END IF;

    IF jsonb_array_length(p_question_set) <> 5 THEN
        RAISE EXCEPTION 'Question set must contain exactly five questions';
    END IF;

    -- Validate answer key.
    IF p_answer_key IS NULL
       OR jsonb_typeof(p_answer_key) <> 'object'
       OR p_answer_key = '{}'::jsonb THEN
        RAISE EXCEPTION 'Answer key must be a non-empty JSON object';
    END IF;

    -- Validate question count.
    IF p_total_questions IS NULL OR p_total_questions <> 5 THEN
        RAISE EXCEPTION 'A quiz must contain exactly five questions';
    END IF;

    -- Validate generation metadata.
    IF p_input_fingerprint IS NULL OR btrim(p_input_fingerprint) = ''
       OR p_model_provider IS NULL OR btrim(p_model_provider) = ''
       OR p_model_name IS NULL OR btrim(p_model_name) = ''
       OR p_prompt_version IS NULL OR btrim(p_prompt_version) = '' THEN
        RAISE EXCEPTION 'Fingerprint and model metadata are required';
    END IF;

    -- Create the quiz. A matching fingerprint prevents duplicates.
    INSERT INTO public.quizzes (
        user_id,
        resource_id,
        question_set,
        answer_key,
        input_fingerprint,
        model_provider,
        model_name,
        prompt_version
    )
    VALUES (
        p_user_id,
        p_resource_id,
        p_question_set,
        p_answer_key,
        btrim(p_input_fingerprint),
        btrim(p_model_provider),
        btrim(p_model_name),
        btrim(p_prompt_version)
    )
    ON CONFLICT (user_id, resource_id, input_fingerprint)
    DO NOTHING
    RETURNING id INTO v_quiz_id;

    IF v_quiz_id IS NOT NULL THEN
        v_created := TRUE;
    ELSE
        -- Retrieve the existing quiz.
        SELECT q.id, q.question_set
        INTO v_quiz_id, v_question_set
        FROM public.quizzes AS q
        WHERE q.user_id = p_user_id
          AND q.resource_id = p_resource_id
          AND q.input_fingerprint = btrim(p_input_fingerprint);

        IF v_quiz_id IS NULL THEN
            RAISE EXCEPTION 'Could not retrieve existing quiz after conflict';
        END IF;
    END IF;

    -- Create the initial attempt for a new quiz.
    IF v_created THEN
        INSERT INTO public.quiz_attempts (
            user_id,
            quiz_id,
            answers,
            score,
            total_questions,
            status,
            started_at
        )
        VALUES (
            p_user_id,
            v_quiz_id,
            '{}'::jsonb,
            0,
            p_total_questions,
            'in_progress',
            now()
        )
        RETURNING id INTO v_attempt_id;
    ELSE
        -- Reuse the existing attempt.
        SELECT qa.id
        INTO v_attempt_id
        FROM public.quiz_attempts AS qa
        WHERE qa.quiz_id = v_quiz_id
          AND qa.user_id = p_user_id;

        IF v_attempt_id IS NULL THEN
            RAISE EXCEPTION 'Existing quiz has no associated attempt';
        END IF;
    END IF;

    -- Return questions, never the answer key.
    RETURN QUERY
    SELECT
        v_quiz_id,
        v_attempt_id,
        COALESCE(v_question_set, p_question_set),
        p_total_questions,
        v_created;
END;
$$;

-- Restrict execution to the trusted backend.
REVOKE ALL ON FUNCTION public.create_quiz_with_attempt(
    UUID, UUID, JSONB, JSONB, INTEGER, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_quiz_with_attempt(
    UUID, UUID, JSONB, JSONB, INTEGER, TEXT, TEXT, TEXT, TEXT
) TO service_role;
