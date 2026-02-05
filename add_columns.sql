-- 1) 컬럼 추가
ALTER TABLE customers ADD COLUMN IF NOT EXISTS avg_order_value NUMERIC DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ltv_score INTEGER DEFAULT 0;

-- 2) avg_order_value 계산 (총구매금액 / 구매횟수)
UPDATE customers 
SET avg_order_value = CASE 
  WHEN purchase_count > 0 THEN ROUND(total_purchase_amount::numeric / purchase_count, 0)
  ELSE 0 
END
WHERE company_id = '50031bbd-9930-46e9-af39-2e0d18a72727';

-- 3) ltv_score 계산 (0~100점, 구매금액40% + 구매횟수30% + 최근구매일30%)
UPDATE customers 
SET ltv_score = LEAST(100, GREATEST(0,
  ROUND(
    (LEAST(total_purchase_amount::numeric / 500000, 1) * 40) +
    (LEAST(purchase_count::numeric / 15, 1) * 30) +
    (CASE 
      WHEN recent_purchase_date >= NOW() - INTERVAL '30 days' THEN 30
      WHEN recent_purchase_date >= NOW() - INTERVAL '90 days' THEN 20
      WHEN recent_purchase_date >= NOW() - INTERVAL '180 days' THEN 10
      ELSE 0
    END)
  )
))
WHERE company_id = '50031bbd-9930-46e9-af39-2e0d18a72727';
