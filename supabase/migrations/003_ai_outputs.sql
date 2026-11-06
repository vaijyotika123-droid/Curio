--------------------------------------------------------------------------------
-- 7. AI_OUTPUTS
--------------------------------------------------------------------------------
CREATE TABLE public.ai_outputs (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    feature_type TEXT NOT NULL,
    output_data JSONB NOT NULL,
    input_fingerprint TEXT NOT NULL,
    model_provider TEXT NOT NULL,
    model_name TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    output_schema_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ai_outputs_pkey PRIMARY KEY (id),
    CONSTRAINT uq_ai_outputs_id_user_id UNIQUE (id, user_id),
    CONSTRAINT ai_outputs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT ai_outputs_feature_type_check CHECK (feature_type IN ('overview', 'exploration', 'visualisation', 'connection')),
    CONSTRAINT ai_outputs_input_fingerprint_check CHECK (length(trim(input_fingerprint)) > 0),
    CONSTRAINT ai_outputs_model_name_check CHECK (length(trim(model_name)) > 0),
    CONSTRAINT ai_outputs_model_provider_check CHECK (length(trim(model_provider)) > 0),
    CONSTRAINT ai_outputs_prompt_version_check CHECK (length(trim(prompt_version)) > 0),
    CONSTRAINT ai_outputs_output_schema_version_check CHECK (length(trim(output_schema_version)) > 0)
);

CREATE INDEX idx_ai_outputs_user_feature ON public.ai_outputs USING btree (user_id, feature_type, created_at DESC);

--------------------------------------------------------------------------------
-- 8. AI_OUTPUT_RESOURCES
--------------------------------------------------------------------------------
CREATE TABLE public.ai_output_resources (
    output_id UUID NOT NULL,
    resource_id UUID NOT NULL,
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ai_output_resources_pkey PRIMARY KEY (output_id, resource_id),
    CONSTRAINT fk_ai_output_resources_output FOREIGN KEY (output_id, user_id) 
        REFERENCES public.ai_outputs(id, user_id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_output_resources_resource FOREIGN KEY (resource_id, user_id) 
        REFERENCES public.resources (id, user_id) ON DELETE CASCADE
);

CREATE INDEX idx_ai_output_resources_lookup ON public.ai_output_resources USING btree (resource_id, output_id);