
-- Migration: Curio Create Resource Transaction RPC
-- MVP URL policy:
-- HTTP/HTTPS only; standard DNS hostnames and valid ports.
-- IPv4 and IPv6 addresses are not supported.
-- Raw whitespace and backslashes are rejected.
-- All utm_* parameters and known click IDs are removed.

-- ============================================================
-- 1. DATABASE URL NORMALIZATION HELPER
-- ============================================================


CREATE OR REPLACE FUNCTION public.normalize_url_db(p_raw_url TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_url TEXT;
    v_hash_pos INT;
    v_query_pos INT;
    v_path_and_query TEXT;
    v_query_str TEXT := '';
    v_params TEXT[];
    v_param TEXT;
    v_key_val TEXT[];
    v_filtered_params TEXT[] := ARRAY[]::TEXT[];
    v_lower_key TEXT;
    v_scheme_pos INT;
    v_scheme TEXT;
    v_path_only TEXT;
    v_at_pos INT;
    v_slash_pos INT;
    v_colon_pos INT;
    v_authority TEXT;
    v_hostname TEXT;
    v_port_str TEXT;
    v_port_val INT;
    v_rest TEXT;
BEGIN
    -- Reject empty URLs
    IF p_raw_url IS NULL OR pg_catalog.btrim(p_raw_url) = '' THEN
        RAISE EXCEPTION 'URL cannot be empty.'
            USING ERRCODE = '22000';
    END IF;

    -- Reject raw whitespace and backslashes
    IF p_raw_url ~ '[[:space:]]'
       OR pg_catalog.strpos(p_raw_url, pg_catalog.chr(92)) > 0 THEN
        RAISE EXCEPTION 'URL cannot contain raw whitespace or backslashes.'
            USING ERRCODE = '22000';
    END IF;

    v_url := p_raw_url;

    -- Enforce URL length
    IF pg_catalog.length(v_url) > 2048 THEN
        RAISE EXCEPTION 'URL exceeds maximum allowed length of 2048 characters.'
            USING ERRCODE = '22000';
    END IF;

    -- Validate and normalize scheme
    IF v_url !~* '^https?://' THEN
        RAISE EXCEPTION 'Only HTTP and HTTPS protocols are supported.'
            USING ERRCODE = '22000';
    END IF;

    v_scheme_pos := pg_catalog.strpos(v_url, '://');
    v_scheme := pg_catalog.lower(
        pg_catalog.substr(v_url, 1, v_scheme_pos - 1)
    );

    -- Remove fragment
    v_hash_pos := pg_catalog.strpos(v_url, '#');

    IF v_hash_pos > 0 THEN
        v_url := pg_catalog.substr(v_url, 1, v_hash_pos - 1);
    END IF;

    -- Filter tracking query parameters
    v_query_pos := pg_catalog.strpos(v_url, '?');

    IF v_query_pos > 0 THEN
        v_path_and_query :=
            pg_catalog.substr(v_url, v_query_pos + 1);

        v_url := pg_catalog.substr(v_url, 1, v_query_pos - 1);

        v_params := pg_catalog.string_to_array(v_path_and_query, '&');

        FOREACH v_param IN ARRAY v_params
        LOOP
            v_key_val := pg_catalog.string_to_array(v_param, '=');
            v_lower_key := pg_catalog.lower(
                pg_catalog.btrim(v_key_val[1])
            );

            IF pg_catalog.left(v_lower_key, 4) <> 'utm_'
               AND v_lower_key NOT IN ('gclid', 'fbclid', 'msclkid') THEN
                v_filtered_params :=
                    pg_catalog.array_append(v_filtered_params, v_param);
            END IF;
        END LOOP;

        IF pg_catalog.array_upper(v_filtered_params, 1) IS NOT NULL THEN
            v_query_str :=
                '?' || pg_catalog.array_to_string(v_filtered_params, '&');
        END IF;
    END IF;

    -- Extract authority and path
    v_path_only := pg_catalog.substr(v_url, v_scheme_pos + 3);

    v_slash_pos := pg_catalog.strpos(v_path_only, '/');

    IF v_slash_pos > 0 THEN
        v_authority :=
            pg_catalog.substr(v_path_only, 1, v_slash_pos - 1);

        v_rest :=
            pg_catalog.substr(v_path_only, v_slash_pos);
    ELSE
        v_authority := v_path_only;
        v_rest := '';
    END IF;

    IF v_authority IS NULL OR v_authority = '' THEN
        RAISE EXCEPTION 'URL must contain a valid non-empty hostname.'
            USING ERRCODE = '22000';
    END IF;

    -- Reject userinfo
    v_at_pos := pg_catalog.strpos(v_authority, '@');

    IF v_at_pos > 0 THEN
        RAISE EXCEPTION 'User credentials in URLs are not supported.'
            USING ERRCODE = '22000';
    END IF;

    -- Reject IPv6 literals
    IF pg_catalog.left(v_authority, 1) = '['
       OR pg_catalog.strpos(v_authority, ']') > 0 THEN
        RAISE EXCEPTION 'IPv6 URLs are not supported.'
            USING ERRCODE = '22000';
    END IF;

    -- Parse hostname and optional port
    v_colon_pos := pg_catalog.strpos(v_authority, ':');

    IF v_colon_pos > 0 THEN
        v_hostname :=
            pg_catalog.substr(v_authority, 1, v_colon_pos - 1);

        v_port_str :=
            pg_catalog.substr(v_authority, v_colon_pos + 1);

        IF v_port_str !~ '^[0-9]+$' THEN
            RAISE EXCEPTION 'Malformed port number in URL.'
                USING ERRCODE = '22000';
        END IF;

        IF pg_catalog.length(v_port_str) > 5 THEN
            RAISE EXCEPTION 'Out of range port number in URL.'
                USING ERRCODE = '22000';
        END IF;

        v_port_val := v_port_str::INT;

        IF v_port_val < 1 OR v_port_val > 65535 THEN
            RAISE EXCEPTION 'Out of range port number in URL.'
                USING ERRCODE = '22000';
        END IF;
    ELSE
        v_hostname := v_authority;
    END IF;

    -- Reject numeric IP-like hostnames
    IF v_hostname ~ '^[0-9.]+$' THEN
        RAISE EXCEPTION 'IP address URLs are not supported.'
            USING ERRCODE = '22000';
    END IF;

    -- Validate DNS hostname
    IF v_hostname = ''
       OR pg_catalog.length(v_hostname) > 253
       OR v_hostname !~ '^[a-zA-Z0-9.-]+$'
       OR v_hostname ~ '^\.'
       OR v_hostname ~ '\.$'
       OR v_hostname LIKE '%..%'
       OR v_hostname ~ '(^|\.)-'
       OR v_hostname ~ '-(\.|$)'
       OR v_hostname ~ '(^|\.)[a-zA-Z0-9-]{64,}(\.|$)' THEN
        RAISE EXCEPTION 'Invalid or malformed hostname in URL.'
            USING ERRCODE = '22000';
    END IF;

    -- Normalize hostname and port
    v_hostname := pg_catalog.lower(v_hostname);

    IF v_colon_pos > 0 THEN
        -- Remove default HTTP and HTTPS ports
        IF NOT (
            (v_scheme = 'http' AND v_port_val = 80)
            OR
            (v_scheme = 'https' AND v_port_val = 443)
        ) THEN
            v_authority :=
                v_hostname || ':' || v_port_val::TEXT;
        ELSE
            v_authority := v_hostname;
        END IF;
    ELSE
        v_authority := v_hostname;
    END IF;

    -- Normalize root path and trailing slash
    IF v_rest = '/' THEN
        v_rest := '';
    ELSIF v_rest ~ '/$' THEN
        v_rest := pg_catalog.regexp_replace(v_rest, '/$', '');
    END IF;

    -- Reconstruct canonical URL
    RETURN v_scheme || '://' || v_authority || v_rest || v_query_str;
END;
$$;


-- Restrict helper execution
REVOKE EXECUTE ON FUNCTION public.normalize_url_db(TEXT)
FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 2. CLEAN UP OLD FIVE-ARGUMENT RPC
-- ============================================================

DO $$
DECLARE
    v_old_func REGPROCEDURE;
BEGIN
    v_old_func := pg_catalog.to_regprocedure(
        'public.create_resource_transaction(text,text,text,text,text)'
    );

    IF v_old_func IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION
            public.create_resource_transaction(TEXT, TEXT, TEXT, TEXT, TEXT)
            FROM PUBLIC, anon, authenticated;

        DROP FUNCTION
            public.create_resource_transaction(TEXT, TEXT, TEXT, TEXT, TEXT);
    END IF;
END;
$$;


-- ============================================================
-- 3. FOUR-ARGUMENT RESOURCE CREATION RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_resource_transaction(
    p_input_method TEXT,
    p_title TEXT,
    p_source_url TEXT DEFAULT NULL,
    p_content_text TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_resource RECORD;
    v_final_title TEXT;
    v_derived_normalized_url TEXT;
    v_colon_pos INT;
    v_slash_pos INT;
    v_fallback TEXT;
    v_host_part TEXT;
    v_path_part TEXT;
    v_path_segments TEXT[];
    v_upper_idx INT;
    v_constraint_name TEXT;
BEGIN
    -- Derive authenticated user identity
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: auth.uid() cannot be null.'
            USING ERRCODE = '28000';
    END IF;

    -- Validate input method
    IF p_input_method NOT IN ('url', 'manual_text') THEN
        RAISE EXCEPTION
            'Invalid input_method: %. Only url and manual_text are supported.',
            p_input_method
            USING ERRCODE = '22023';
    END IF;

    -- ========================================================
    -- OPERATION A: URL RESOURCE CREATION
    -- ========================================================

    IF p_input_method = 'url' THEN

        IF p_source_url IS NULL OR pg_catalog.btrim(p_source_url) = '' THEN
            RAISE EXCEPTION 'source_url is required for url input method.'
                USING ERRCODE = '22000';
        END IF;

        -- Derive normalized URL inside PostgreSQL
        BEGIN
            v_derived_normalized_url :=
                public.normalize_url_db(p_source_url);
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION
                'Invalid URL provided: %', SQLERRM
                USING ERRCODE = '22000';
        END;

        -- Check for an existing resource belonging to this user
        SELECT *
        INTO v_resource
        FROM public.resources
        WHERE user_id = v_user_id
          AND source_url_normalized = v_derived_normalized_url;

        IF FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'data', pg_catalog.to_jsonb(v_resource),
                'is_duplicate', TRUE
            );
        END IF;

        -- Generate fallback title if title is blank
        v_final_title := pg_catalog.btrim(COALESCE(p_title, ''));

        IF v_final_title = '' THEN
            v_fallback := v_derived_normalized_url;

            v_colon_pos := pg_catalog.strpos(v_fallback, '://');

            IF v_colon_pos > 0 THEN
                v_fallback :=
                    pg_catalog.substr(v_fallback, v_colon_pos + 3);
            END IF;

            v_slash_pos := pg_catalog.strpos(v_fallback, '/');

            IF v_slash_pos > 0 THEN
                v_host_part :=
                    pg_catalog.substr(v_fallback, 1, v_slash_pos - 1);

                v_path_part :=
                    pg_catalog.substr(v_fallback, v_slash_pos + 1);

                v_path_part :=
                    pg_catalog.regexp_replace(v_path_part, '[?#].*$', '');

                v_path_part :=
                    pg_catalog.regexp_replace(v_path_part, '/$', '');

                IF v_path_part != '' THEN
                    v_path_segments :=
                        pg_catalog.string_to_array(v_path_part, '/');

                    v_upper_idx :=
                        pg_catalog.array_upper(v_path_segments, 1);

                    IF v_upper_idx IS NOT NULL THEN
                        v_path_part := v_path_segments[v_upper_idx];
                    END IF;

                    IF v_path_part IS NOT NULL AND v_path_part != '' THEN
                        v_final_title :=
                            v_host_part || ' / ' || v_path_part;
                    ELSE
                        v_final_title := v_host_part;
                    END IF;
                ELSE
                    v_final_title := v_host_part;
                END IF;
            ELSE
                v_final_title := v_fallback;
            END IF;
        END IF;

        -- Enforce title length
        IF pg_catalog.length(v_final_title) > 300 THEN
            v_final_title := pg_catalog.substr(v_final_title, 1, 300);
        END IF;

        -- Insert resource and processing job atomically
        BEGIN
            INSERT INTO public.resources (
                user_id,
                title,
                source_url,
                source_url_normalized,
                input_method,
                extraction_status,
                ai_analysis_status
            )
            VALUES (
                v_user_id,
                v_final_title,
                p_source_url,
                v_derived_normalized_url,
                'url',
                'pending',
                'not_started'
            )
            RETURNING * INTO v_resource;

            INSERT INTO public.processing_jobs (
                resource_id,
                user_id,
                job_type,
                status,
                attempt_number,
                started_at,
                completed_at
            )
            VALUES (
                v_resource.id,
                v_user_id,
                'content_extraction',
                'queued',
                1,
                NULL,
                NULL
            );

        EXCEPTION WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS
                v_constraint_name = CONSTRAINT_NAME;

            IF v_constraint_name = 'uq_idx_resources_user_normalized_url' THEN
                SELECT *
                INTO v_resource
                FROM public.resources
                WHERE user_id = v_user_id
                  AND source_url_normalized = v_derived_normalized_url;

                IF FOUND THEN
                    RETURN pg_catalog.jsonb_build_object(
                        'data', pg_catalog.to_jsonb(v_resource),
                        'is_duplicate', TRUE
                    );
                END IF;
            END IF;

            RAISE;
        END;

        RETURN pg_catalog.jsonb_build_object(
            'data', pg_catalog.to_jsonb(v_resource),
            'is_duplicate', FALSE
        );


    -- ========================================================
    -- OPERATION B: MANUAL TEXT RESOURCE CREATION
    -- ========================================================

    ELSIF p_input_method = 'manual_text' THEN

        IF p_title IS NULL OR pg_catalog.btrim(p_title) = '' THEN
            RAISE EXCEPTION 'title is required for manual_text.'
                USING ERRCODE = '22000';
        END IF;

        IF pg_catalog.length(p_title) > 300 THEN
            RAISE EXCEPTION 'title cannot exceed 300 characters.'
                USING ERRCODE = '22000';
        END IF;

        IF p_content_text IS NULL
           OR pg_catalog.btrim(p_content_text) = '' THEN
            RAISE EXCEPTION 'content_text is required for manual_text.'
                USING ERRCODE = '22000';
        END IF;

        IF pg_catalog.length(p_content_text) > 100000 THEN
            RAISE EXCEPTION 'content_text cannot exceed 100,000 characters.'
                USING ERRCODE = '22000';
        END IF;

        -- Insert resource
        INSERT INTO public.resources (
            user_id,
            title,
            source_url,
            source_url_normalized,
            input_method,
            extraction_status,
            ai_analysis_status
        )
        VALUES (
            v_user_id,
            pg_catalog.btrim(p_title),
            NULL,
            NULL,
            'manual_text',
            'not_required',
            'not_started'
        )
        RETURNING * INTO v_resource;

        -- Insert associated manual content
        INSERT INTO public.resource_contents (
            resource_id,
            user_id,
            content_text,
            content_source,
            content_version
        )
        VALUES (
            v_resource.id,
            v_user_id,
            p_content_text,
            'manual_text',
            1
        );

        RETURN pg_catalog.jsonb_build_object(
            'data', pg_catalog.to_jsonb(v_resource),
            'is_duplicate', FALSE
        );

    END IF;

    RAISE EXCEPTION 'Unsupported input method: %', p_input_method
        USING ERRCODE = '22023';
END;
$$;


-- ============================================================
-- 4. RPC EXECUTION PERMISSIONS
-- ============================================================

REVOKE EXECUTE ON FUNCTION
    public.create_resource_transaction(TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION
    public.create_resource_transaction(TEXT, TEXT, TEXT, TEXT)
    FROM anon;

GRANT EXECUTE ON FUNCTION
    public.create_resource_transaction(TEXT, TEXT, TEXT, TEXT)
    TO authenticated;
