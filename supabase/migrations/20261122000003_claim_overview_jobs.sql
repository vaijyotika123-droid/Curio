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
          AND pj.job_type = 'ai_analysis'
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