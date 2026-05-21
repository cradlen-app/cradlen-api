-- Rename the GYN specialty to OBGYN (canonical code going forward).
UPDATE specialties
SET code = 'OBGYN', name = 'OB/GYN'
WHERE code = 'GYN';

-- Fix any visits that received 'GYN' as specialty_code
-- (visits booked after the dynamic-specialty change but before this migration).
UPDATE visits
SET specialty_code = 'OBGYN'
WHERE specialty_code = 'GYN';
