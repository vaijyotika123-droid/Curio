
-- Serialize overview saves per resource and fingerprint.
-- Existing overview versions are retained.

CREATE OR REPLACE FUNCTION public.save_resource_overview(
    p_user_id UUID,
    p_resource_id UUID,
    p_output_data JSONB,
    p_input_fingerprint TEXT,
    p_model_provider TEXT,
    p_model_name TEXT,
    p_prompt_version TEXT,
    p_output_schema_version TEXT
)
RETURNS TABLE (
    output_id UUID,
    created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_output_id UUID;
    v_resource_owner UUID;
BEGIN
    IF p_user_id IS NULL OR p_resource_id IS NULL THEN
        RAISE EXCEPTION 'User and resource IDs are required';
    END IF;

    IF p_output_data IS NULL
       OR jsonb_typeof(p_output_data) <> 'object' THEN
        RAISE EXCEPTION 'Overview output must be a JSON object';
    END IF;

    IF NULLIF(TRIM(p_input_fingerprint), '') IS NULL
       OR NULLIF(TRIM(p_model_provider), '') IS NULL
       OR NULLIF(TRIM(p_model_name), '') IS NULL
       OR NULLIF(TRIM(p_prompt_version), '') IS NULL
       OR NULLIF(TRIM(p_output_schema_version), '') IS NULL THEN
        RAISE EXCEPTION 'Overview metadata is incomplete';
    END IF;

    -- Lock the resource to serialize concurrent overview saves.
    SELECT r.user_id
    INTO v_resource_owner
    FROM public.resources AS r
    WHERE r.id = p_resource_id
    FOR UPDATE;

    IF NOT FOUND OR v_resource_owner <> p_user_id THEN
        RAISE EXCEPTION 'Resource not found or ownership mismatch';
    END IF;

    -- Reuse an existing overview for this resource and fingerprint.
    SELECT ao.id
    INTO v_output_id
    FROM public.ai_outputs AS ao
    JOIN public.ai_output_resources AS aor
      ON aor.output_id = ao.id
     AND aor.user_id = ao.user_id
    WHERE aor.resource_id = p_resource_id
      AND aor.user_id = p_user_id
      AND ao.feature_type = 'overview'
      AND ao.input_fingerprint = p_input_fingerprint
    ORDER BY ao.created_at DESC, ao.id DESC
    LIMIT 1;

    IF FOUND THEN
        RETURN QUERY SELECT v_output_id, FALSE;
        RETURN;
    END IF;

    -- Insert a new overview version.
    INSERT INTO public.ai_outputs (
        user_id,
        feature_type,
        output_data,
        input_fingerprint,
        model_provider,
        model_name,
        prompt_version,
        output_schema_version
    )
    VALUES (
        p_user_id,
        'overview',
        p_output_data,
        p_input_fingerprint,
        p_model_provider,
        p_model_name,
        p_prompt_version,
        p_output_schema_version
    )
    RETURNING id INTO v_output_id;

    INSERT INTO public.ai_output_resources (
        output_id,
        resource_id,
        user_id
    )
    VALUES (
        v_output_id,
        p_resource_id,
        p_user_id
    );

    RETURN QUERY SELECT v_output_id, TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.save_resource_overview(
    UUID, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_resource_overview(
    UUID, UUID, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;
