DO $$
DECLARE
  comp_id UUID;
  names TEXT[] := ARRAY['김철수','이영희','박민수','최수진','정대호','강민지','윤성민','한지원','임태현','서예진','홍길동','김미영','이준호','박서연','최민재'];
  grades TEXT[] := ARRAY['VIP','GOLD','SILVER','BRONZE','NORMAL'];
  regions TEXT[] := ARRAY['서울','부산','대구','인천','광주','대전','울산','경기','강원','충북','충남','전북','전남','경북','경남','제주'];
BEGIN
  SELECT id INTO comp_id FROM companies WHERE company_code = 'TEST001';
  FOR i IN 1..400000 LOOP
    INSERT INTO customers (company_id, name, phone, gender, birth_date, grade, region, sms_opt_in, source)
    VALUES (
      comp_id,
      names[1 + (i % 15)],
      LPAD((1000010000 + i)::TEXT, 11, '0'),
      CASE WHEN i % 2 = 0 THEN 'M' ELSE 'F' END,
      '1970-01-01'::DATE + (i % 15000),
      grades[1 + (i % 5)],
      regions[1 + (i % 16)],
      (i % 10 != 0),
      'sync'
    )
    ON CONFLICT (company_id, phone) DO NOTHING;
  END LOOP;
END $$;
