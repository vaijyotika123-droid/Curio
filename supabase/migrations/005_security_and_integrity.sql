--------------------------------------------------------------------------------
-- 1. REUSABLE UPDATED_AT TRIGGER FUNCTION
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER 
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Attach triggers to all 9 tables with updated_at
CREATE OR REPLACE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER trg_resources_updated_at BEFORE UPDATE ON public.resources FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER trg_resource_contents_updated_at BEFORE UPDATE ON public.resource_contents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER trg_topics_updated_at BEFORE UPDATE ON public.topics FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER trg_processing_jobs_updated_at BEFORE UPDATE ON public.processing_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER trg_ai_outputs_updated_at BEFORE UPDATE ON public.ai_outputs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER trg_quiz_attempts_updated_at BEFORE UPDATE ON public.quiz_attempts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER trg_challenge_sessions_updated_at BEFORE UPDATE ON public.challenge_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER trg_challenge_responses_updated_at BEFORE UPDATE ON public.challenge_responses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

--------------------------------------------------------------------------------
-- 2. AUTOMATIC TOPIC NAME NORMALISATION TRIGGER FUNCTION
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_topic_name()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.name_normalized := lower(trim(NEW.name));
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_topics_normalize_name
    BEFORE INSERT OR UPDATE OF name ON public.topics
    FOR EACH ROW
    EXECUTE FUNCTION public.normalize_topic_name();

--------------------------------------------------------------------------------
-- 3. SAFE STORAGE RESOURCE VALIDATION FUNCTION
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.storage_check_resource_owner(object_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    path_parts TEXT[];
    raw_resource_id TEXT;
    target_resource_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    path_parts := storage.foldername(object_name);
    
    -- Path structure must be user_id/resource_id/filename
    IF array_length(path_parts, 1) < 2 THEN
        RETURN FALSE;
    END IF;

    -- Validate user_id prefix matches current authenticated user
    IF path_parts[1] != v_user_id::text THEN
        RETURN FALSE;
    END IF;

    raw_resource_id := path_parts[2];

    -- Safe UUID syntax check prior to casting
    IF raw_resource_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN FALSE;
    END IF;

    target_resource_id := raw_resource_id::uuid;

    -- Verify resource exists and belongs to current authenticated user
    RETURN EXISTS (
        SELECT 1 FROM public.resources 
        WHERE id = target_resource_id AND user_id = v_user_id
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.storage_check_resource_owner(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_check_resource_owner(TEXT) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 4. EXPLICIT PRIVILEGE CLEANUP (REVOKE / GRANT)
--------------------------------------------------------------------------------

-- Revoke all table-level permissions from PUBLIC, anon, and authenticated roles across all 13 tables
REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.resources FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.resource_contents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.topics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.resource_topics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.processing_jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ai_outputs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ai_output_resources FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.quizzes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.quiz_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.challenge_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.challenge_responses FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.challenge_session_resources FROM PUBLIC, anon, authenticated;

-- Ensure service_role retains full administrative permissions for backend workflows
GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.resources TO service_role;
GRANT ALL ON public.resource_contents TO service_role;
GRANT ALL ON public.topics TO service_role;
GRANT ALL ON public.resource_topics TO service_role;
GRANT ALL ON public.processing_jobs TO service_role;
GRANT ALL ON public.ai_outputs TO service_role;
GRANT ALL ON public.ai_output_resources TO service_role;
GRANT ALL ON public.quizzes TO service_role;
GRANT ALL ON public.quiz_attempts TO service_role;
GRANT ALL ON public.challenge_sessions TO service_role;
GRANT ALL ON public.challenge_responses TO service_role;
GRANT ALL ON public.challenge_session_resources TO service_role;

--------------------------------------------------------------------------------
-- 5. GRANULAR COLUMN-LEVEL GRANTS FOR AUTHENTICATED
--------------------------------------------------------------------------------

-- 1. PROFILES
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, avatar_url) ON public.profiles TO authenticated;

-- 2. RESOURCES
GRANT SELECT ON public.resources TO authenticated;
GRANT INSERT (user_id, title, source_url, source_name, platform, content_type, input_method) ON public.resources TO authenticated;
GRANT UPDATE (title, source_name, platform, content_type) ON public.resources TO authenticated;

-- 3. RESOURCE_CONTENTS
GRANT SELECT ON public.resource_contents TO authenticated;

-- 4. TOPICS
GRANT SELECT ON public.topics TO authenticated;
GRANT INSERT (user_id, name, description, creation_method) ON public.topics TO authenticated;
GRANT UPDATE (name, description) ON public.topics TO authenticated;
GRANT DELETE ON public.topics TO authenticated;

-- 5. RESOURCE_TOPICS
GRANT SELECT ON public.resource_topics TO authenticated;
GRANT INSERT ON public.resource_topics TO authenticated;
GRANT DELETE ON public.resource_topics TO authenticated;

-- 6. PROCESSING_JOBS
GRANT SELECT ON public.processing_jobs TO authenticated;

-- 7. AI_OUTPUTS
GRANT SELECT ON public.ai_outputs TO authenticated;

-- 8. AI_OUTPUT_RESOURCES
GRANT SELECT ON public.ai_output_resources TO authenticated;

-- 9. QUIZZES
GRANT SELECT ON public.quizzes TO authenticated;

-- 10. QUIZ_ATTEMPTS
GRANT SELECT ON public.quiz_attempts TO authenticated;
GRANT UPDATE (answers) ON public.quiz_attempts TO authenticated;

-- 11. CHALLENGE_SESSIONS
GRANT SELECT ON public.challenge_sessions TO authenticated;

-- 12. CHALLENGE_RESPONSES
GRANT SELECT ON public.challenge_responses TO authenticated;
GRANT UPDATE (user_response) ON public.challenge_responses TO authenticated;

-- 13. CHALLENGE_SESSION_RESOURCES
GRANT SELECT ON public.challenge_session_resources TO authenticated;

--------------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) POLICIES FOR ALL 13 TABLES
--------------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_output_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_session_resources ENABLE ROW LEVEL SECURITY;

-- 1. PROFILES
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- 2. RESOURCES
CREATE POLICY "Users can view own resources" ON public.resources FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own resources" ON public.resources FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own resources" ON public.resources FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 3. RESOURCE_CONTENTS
CREATE POLICY "Users can view own resource contents" ON public.resource_contents FOR SELECT USING (user_id = auth.uid());

-- 4. TOPICS
CREATE POLICY "Users can view own topics" ON public.topics FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own topics" ON public.topics FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own topics" ON public.topics FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own topics" ON public.topics FOR DELETE USING (user_id = auth.uid());

-- 5. RESOURCE_TOPICS
CREATE POLICY "Users can view own resource topics" ON public.resource_topics FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own resource topics" ON public.resource_topics FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own resource topics" ON public.resource_topics FOR DELETE USING (user_id = auth.uid());

-- 6. PROCESSING_JOBS
CREATE POLICY "Users can view own processing jobs" ON public.processing_jobs FOR SELECT USING (user_id = auth.uid());

-- 7. AI_OUTPUTS
CREATE POLICY "Users can view own AI outputs" ON public.ai_outputs FOR SELECT USING (user_id = auth.uid());

-- 8. AI_OUTPUT_RESOURCES
CREATE POLICY "Users can view own AI output resources" ON public.ai_output_resources FOR SELECT USING (user_id = auth.uid());

-- 9. QUIZZES
CREATE POLICY "Users can view own quizzes" ON public.quizzes FOR SELECT USING (user_id = auth.uid());

-- 10. QUIZ_ATTEMPTS
CREATE POLICY "Users can view own quiz attempts" ON public.quiz_attempts FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can update own in-progress answers" ON public.quiz_attempts FOR UPDATE 
    USING (user_id = auth.uid() AND status = 'in_progress') 
    WITH CHECK (user_id = auth.uid() AND status = 'in_progress');

-- 11. CHALLENGE_SESSIONS
CREATE POLICY "Users can view own challenge sessions" ON public.challenge_sessions FOR SELECT USING (user_id = auth.uid());

-- 12. CHALLENGE_RESPONSES
CREATE POLICY "Users can view own challenge responses" ON public.challenge_responses FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can update own eligible responses" ON public.challenge_responses FOR UPDATE 
    USING (user_id = auth.uid() AND status IN ('pending', 'submitted')) 
    WITH CHECK (user_id = auth.uid() AND status IN ('pending', 'submitted'));

-- 13. CHALLENGE_SESSION_RESOURCES
CREATE POLICY "Users can view own challenge session resources" ON public.challenge_session_resources FOR SELECT USING (user_id = auth.uid());

--------------------------------------------------------------------------------
-- 7. SUPABASE STORAGE BUCKET CREATION & SECURE RLS POLICIES
--------------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'curio-resource-files',
    'curio-resource-files',
    FALSE,
    10485760, -- 10 MB limit
    ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage Read/Upload/Delete Policies using single-argument storage_check_resource_owner(name)
CREATE POLICY "Users can read own resource files" 
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'curio-resource-files' 
    AND public.storage_check_resource_owner(name)
);

CREATE POLICY "Users can upload own resource files" 
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'curio-resource-files' 
    AND public.storage_check_resource_owner(name)
);

CREATE POLICY "Users can update own resource files" 
ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'curio-resource-files' 
    AND public.storage_check_resource_owner(name)
)
WITH CHECK (
    bucket_id = 'curio-resource-files' 
    AND public.storage_check_resource_owner(name)
);

CREATE POLICY "Users can delete own resource files" 
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'curio-resource-files' 
    AND public.storage_check_resource_owner(name)
);
