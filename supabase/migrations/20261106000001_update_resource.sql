-- ============================================================
-- update_resource: edit a resource's title and, for manual-text
-- resources only, its content.
--
-- Why a function: authenticated users have SELECT-only access to
-- resource_contents (no UPDATE grant or policy), and a title +
-- content edit must succeed or fail together.
--
-- Rules enforced here (mirroring create-resource):
--   * caller must be signed in and own the resource
--   * title: 1-300 characters after trimming
--   * manual_text: content required, 1-100,000 characters
--   * url resources: title only (content / URL cannot be changed)
--   * content_version increases only when the content really changed
--
-- Rollback: DROP FUNCTION public.update_resource(uuid, text, text);
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_resource(
    p_resource_id UUID,
    p_title TEXT,
    p_content_text TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_title TEXT;
    v_input_method TEXT;
    v_content_version INTEGER;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to edit a resource.'
            USING ERRCODE = '28000';
    END IF;

    v_title := pg_catalog.btrim(COALESCE(p_title, ''));
    IF pg_catalog.length(v_title) = 0 OR pg_catalog.length(v_title) > 300 THEN
        RAISE EXCEPTION 'Title must be between 1 and 300 characters.'
            USING ERRCODE = '22000';
    END IF;

    -- Lock the row and confirm it belongs to the caller
    SELECT r.input_method
    INTO v_input_method
    FROM public.resources r
    WHERE r.id = p_resource_id
      AND r.user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Resource not found.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_input_method = 'manual_text' THEN
        IF p_content_text IS NULL OR pg_catalog.btrim(p_content_text) = '' THEN
            RAISE EXCEPTION 'Content is required for text resources.'
                USING ERRCODE = '22000';
        END IF;
        IF pg_catalog.length(p_content_text) > 100000 THEN
            RAISE EXCEPTION 'Content cannot exceed 100,000 characters.'
                USING ERRCODE = '22000';
        END IF;
    ELSIF p_content_text IS NOT NULL THEN
        RAISE EXCEPTION 'Content can only be edited for text resources.'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.resources
    SET title = v_title
    WHERE id = p_resource_id
      AND user_id = v_user_id;

    IF v_input_method = 'manual_text' THEN
        UPDATE public.resource_contents rc
        SET content_text = p_content_text,
            content_version = rc.content_version
                + CASE WHEN rc.content_text IS DISTINCT FROM p_content_text THEN 1 ELSE 0 END
        WHERE rc.resource_id = p_resource_id
          AND rc.user_id = v_user_id
        RETURNING rc.content_version INTO v_content_version;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Content record not found for this resource.'
                USING ERRCODE = 'P0002';
        END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'id', p_resource_id,
        'title', v_title,
        'content_version', v_content_version
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_resource(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_resource(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_resource(UUID, TEXT, TEXT) TO authenticated;
