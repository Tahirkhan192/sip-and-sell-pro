
-- Add business/time settings columns
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Karachi',
  ADD COLUMN IF NOT EXISTS business_day_start_time time NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS business_month_start_day integer NOT NULL DEFAULT 6 CHECK (business_month_start_day BETWEEN 1 AND 28);

INSERT INTO public.settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Helper: read config
CREATE OR REPLACE FUNCTION public.get_business_config()
RETURNS TABLE(tz text, start_time time, month_start_day int)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(timezone,'Asia/Karachi'),
         COALESCE(business_day_start_time,'08:00'::time),
         COALESCE(business_month_start_day,6)
  FROM public.settings WHERE id=1
  UNION ALL SELECT 'Asia/Karachi','08:00'::time,6
  LIMIT 1;
$$;

-- Replace business_date to use configurable tz + rollover
CREATE OR REPLACE FUNCTION public.business_date(ts timestamptz)
RETURNS date
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_tz text; v_st time; v_local timestamp;
BEGIN
  SELECT tz, start_time INTO v_tz, v_st FROM public.get_business_config();
  v_local := ts AT TIME ZONE v_tz;
  RETURN (v_local - (v_st - '00:00'::time))::date;
END $$;

CREATE OR REPLACE FUNCTION public.business_date_of(_ts timestamptz)
RETURNS date
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_tz text; v_st time; v_local timestamp;
BEGIN
  SELECT tz, start_time INTO v_tz, v_st FROM public.get_business_config();
  v_local := _ts AT TIME ZONE v_tz;
  RETURN (v_local - (v_st - '00:00'::time))::date;
END $$;
