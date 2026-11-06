--------------------------------------------------------------------------------
-- 5. RESOURCE_TOPICS
--------------------------------------------------------------------------------
CREATE TABLE public.resource_topics (
    resource_id UUID NOT NULL,
    topic_id UUID NOT NULL,
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (resource_id, topic_id),
    
    -- Composite FKs enforcing same-user ownership
    CONSTRAINT fk_resource_topics_resource FOREIGN KEY (resource_id, user_id)
        REFERENCES public.resources (id, user_id) ON DELETE CASCADE,
    CONSTRAINT fk_resource_topics_topic FOREIGN KEY (topic_id, user_id)
        REFERENCES public.topics (id, user_id) ON DELETE CASCADE
);

-- Essential index for finding all resources under a user's topic
CREATE INDEX idx_resource_topics_user_topic ON public.resource_topics (user_id, topic_id);

--------------------------------------------------------------------------------
-- 6. PROCESSING_JOBS
--------------------------------------------------------------------------------
CREATE TABLE public.processing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id UUID NOT NULL,
    user_id UUID NOT NULL,
    job_type TEXT NOT NULL CHECK (job_type IN ('content_extraction', 'ai_analysis')),
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Composite FK ensuring job belongs to resource owner
    CONSTRAINT fk_processing_jobs_resource FOREIGN KEY (resource_id, user_id)
        REFERENCES public.resources (id, user_id) ON DELETE CASCADE,
    -- Unique attempt number per resource and job type
    CONSTRAINT uq_processing_jobs_attempt UNIQUE (resource_id, job_type, attempt_number),
    -- Timestamp consistency rules
    CONSTRAINT chk_processing_jobs_timestamps CHECK (
        (status = 'queued' AND started_at IS NULL AND completed_at IS NULL) OR
        (status = 'processing' AND started_at IS NOT NULL AND completed_at IS NULL) OR
        (status IN ('completed', 'failed') AND started_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at >= started_at)
    )
);

-- Partial unique index: Prevent duplicate active jobs ('queued' or 'processing') for same resource & job_type
CREATE UNIQUE INDEX uq_idx_processing_jobs_active 
ON public.processing_jobs (resource_id, job_type) 
WHERE status IN ('queued', 'processing');

CREATE INDEX idx_processing_jobs_status ON public.processing_jobs (resource_id, job_type, status);
