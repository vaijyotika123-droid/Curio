--------------------------------------------------------------------------------
-- 1. PROFILES
--------------------------------------------------------------------------------
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Secure Profile Creation Function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'avatar_url'
    );
    RETURN NEW;
END;
$$;

-- Revoke default public execution rights on security definer function
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

--------------------------------------------------------------------------------
-- 2. RESOURCES
--------------------------------------------------------------------------------
CREATE TABLE public.resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    source_url TEXT,
    source_url_normalized TEXT,
    source_name TEXT,
    platform TEXT,
    content_type TEXT,
    input_method TEXT NOT NULL CHECK (input_method IN ('url', 'manual_text', 'screenshot')),
    extraction_status TEXT NOT NULL DEFAULT 'pending' CHECK (extraction_status IN ('pending', 'processing', 'completed', 'failed', 'not_required')),
    ai_analysis_status TEXT NOT NULL DEFAULT 'not_started' CHECK (ai_analysis_status IN ('not_started', 'pending', 'processing', 'completed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Composite unique constraint required for composite foreign key references
    CONSTRAINT uq_resources_id_user_id UNIQUE (id, user_id),
    -- URL input method requires non-empty source_url
    CONSTRAINT chk_resources_url_input_method CHECK (
        (input_method = 'url' AND source_url IS NOT NULL AND length(trim(source_url)) > 0) OR
        (input_method != 'url')
    )
);

-- Partial unique index: Prevent duplicate normalized URLs per user
CREATE UNIQUE INDEX uq_idx_resources_user_normalized_url 
ON public.resources (user_id, source_url_normalized) 
WHERE source_url_normalized IS NOT NULL;

-- Search & Sorting Indexes
CREATE INDEX idx_resources_user_created_at ON public.resources (user_id, created_at DESC);
CREATE INDEX idx_resources_user_title ON public.resources (user_id, title);
CREATE INDEX idx_resources_user_source_name ON public.resources (user_id, source_name);

--------------------------------------------------------------------------------
-- 3. RESOURCE_CONTENTS
--------------------------------------------------------------------------------
CREATE TABLE public.resource_contents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id UUID NOT NULL,
    user_id UUID NOT NULL,
    content_text TEXT NOT NULL,
    content_source TEXT NOT NULL CHECK (content_source IN ('url_extraction', 'manual_text', 'screenshot_ocr', 'transcript')),
    supplementary_notes TEXT,
    content_version INTEGER NOT NULL DEFAULT 1 CHECK (content_version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Strictly 1 content record per resource
    CONSTRAINT uq_resource_contents_resource_id UNIQUE (resource_id),
    -- Composite foreign key enforcing same-user ownership
    CONSTRAINT fk_resource_contents_resource_owner FOREIGN KEY (resource_id, user_id)
        REFERENCES public.resources (id, user_id) ON DELETE CASCADE
);

--------------------------------------------------------------------------------
-- 4. TOPICS
--------------------------------------------------------------------------------
CREATE TABLE public.topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    name_normalized TEXT NOT NULL CHECK (length(trim(name_normalized)) > 0 AND name_normalized = lower(trim(name))),
    description TEXT,
    creation_method TEXT NOT NULL CHECK (creation_method IN ('manual', 'ai_suggestion')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Composite unique constraint required for composite foreign keys
    CONSTRAINT uq_topics_id_user_id UNIQUE (id, user_id),
    -- Topic name uniqueness per user after normalization
    CONSTRAINT uq_topics_user_name_normalized UNIQUE (user_id, name_normalized)
);

CREATE INDEX idx_topics_user_created ON public.topics (user_id, created_at DESC);
