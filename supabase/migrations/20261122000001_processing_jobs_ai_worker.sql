
-- Extend the existing processing queue for AI feature jobs.

ALTER TABLE public.processing_jobs
    DROP CONSTRAINT IF EXISTS processing_jobs_job_type_check;

ALTER TABLE public.processing_jobs
    ADD CONSTRAINT chk_processing_jobs_job_type
    CHECK (
        job_type IN (
            'content_extraction',
            'ai_analysis',
            'quiz_generation'
        )
    );

-- Store feature-specific result identifiers and metadata.
ALTER TABLE public.processing_jobs
    ADD COLUMN IF NOT EXISTS result_data JSONB;


-- Enqueue a job safely.
-- Repeated requests return the existing active job instead of duplicating it.

CREATE OR REPLACE FUNCTION public.enqueue_processing_job(
    p_resource_id UUID,
    p_user_id UUID,
    p_job_type TEXT
)
RETURNS TABLE (
    id UUID,
    status TEXT,
    attempt_number INTEGER,
    created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_resource_owner UUID;
    v_active_id UUID;
    v_active_status TEXT;
    v_active_attempt INTEGER;
    v_next_attempt INTEGER;
    v_new_id UUID;
BEGIN
    IF p_job_type NOT IN (
        'content_extraction',
        'ai_analysis',
        'quiz_generation'
    ) THEN
        RAISE EXCEPTION 'Unsupported processing job type';
    END IF;

    -- Serialize enqueue operations for this resource.
    SELECT r.user_id
    INTO v_resource_owner
    FROM public.resources AS r
    WHERE r.id = p_resource_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Resource not found';
    END IF;

    IF v_resource_owner <> p_user_id THEN
        RAISE EXCEPTION 'Resource ownership mismatch';
    END IF;

    -- Reuse an already queued or processing job.
    SELECT
        pj.id,
        pj.status,
        pj.attempt_number
    INTO
        v_active_id,
        v_active_status,
        v_active_attempt
    FROM public.processing_jobs AS pj
    WHERE pj.resource_id = p_resource_id
      AND pj.job_type = p_job_type
      AND pj.status IN ('queued', 'processing')
    ORDER BY pj.attempt_number DESC
    LIMIT 1;

    IF FOUND THEN
        RETURN QUERY
        SELECT
            v_active_id,
            v_active_status,
            v_active_attempt,
            FALSE;
        RETURN;
    END IF;

    -- Failed attempts remain in the table for history.
    SELECT COALESCE(MAX(pj.attempt_number), 0) + 1
    INTO v_next_attempt
    FROM public.processing_jobs AS pj
    WHERE pj.resource_id = p_resource_id
      AND pj.job_type = p_job_type;

    INSERT INTO public.processing_jobs (
        resource_id,
        user_id,
        job_type,
        status,
        attempt_number
    )
    VALUES (
        p_resource_id,
        p_user_id,
        p_job_type,
        'queued',
        v_next_attempt
    )
    RETURNING processing_jobs.id
    INTO v_new_id;

    RETURN QUERY
    SELECT
        v_new_id,
        'queued'::TEXT,
        v_next_attempt,
        TRUE;
END;
$$;


-- Atomically claim queued AI jobs.
-- FOR UPDATE SKIP LOCKED prevents concurrent workers claiming the same job.

CREATE OR REPLACE FUNCTION public.claim_processing_jobs(
    p_batch_size INTEGER DEFAULT 3
)
RETURNS TABLE (
    id UUID,
    resource_id UUID,
    user_id UUID,
    job_type TEXT,
    attempt_number INTEGER,
    result_data JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_batch_size < 1 OR p_batch_size > 10 THEN
        RAISE EXCEPTION 'Batch size must be between 1 and 10';
    END IF;

    RETURN QUERY
    WITH candidates AS (
        SELECT pj.id
        FROM public.processing_jobs AS pj
        WHERE pj.status = 'queued'
          AND pj.job_type IN ('ai_analysis', 'quiz_generation')
        ORDER BY pj.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT p_batch_size
    ),
    claimed AS (
        UPDATE public.processing_jobs AS pj
        SET
            status = 'processing',
            started_at = NOW(),
            completed_at = NULL,
            error_message = NULL,
            updated_at = NOW()
        FROM candidates AS c
        WHERE pj.id = c.id
        RETURNING
            pj.id,
            pj.resource_id,
            pj.user_id,
            pj.job_type,
            pj.attempt_number,
            pj.result_data
    )
    SELECT
        claimed.id,
        claimed.resource_id,
        claimed.user_id,
        claimed.job_type,
        claimed.attempt_number,
        claimed.result_data
    FROM claimed;
END;
$$;


-- These functions are for trusted server-side execution only.

REVOKE ALL ON FUNCTION public.enqueue_processing_job(UUID, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.claim_processing_jobs(INTEGER)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_processing_job(UUID, UUID, TEXT)
    TO service_role;

GRANT EXECUTE ON FUNCTION public.claim_processing_jobs(INTEGER)
    TO service_role;
