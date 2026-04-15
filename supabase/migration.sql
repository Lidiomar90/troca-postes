-- Migration: Create troca_postes_v2 table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.troca_postes_v2 (
    id TEXT PRIMARY KEY,
    data_troca DATE,
    logradouro TEXT,
    numero TEXT,
    bairro TEXT,
    cidade TEXT,
    uf CHAR(2) DEFAULT 'MG',
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    status TEXT DEFAULT 'PENDENTE',
    responsavel TEXT,
    rede_status TEXT,
    rede_dist_m INTEGER,
    rede_sigla TEXT,
    foto_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.troca_postes_v2 ENABLE ROW LEVEL SECURITY;

-- Create policy for public read (if needed)
CREATE POLICY "Public Read" ON public.troca_postes_v2
    FOR SELECT USING (true);

-- Create policy for authenticated upsert
CREATE POLICY "Authenticated Upsert" ON public.troca_postes_v2
    FOR ALL USING (auth.role() = 'authenticated' OR true); -- Adjust based on your security needs
