-- Rename specialty code GYN → OBGYN (the specialty was always OB/GYN; the code was wrong)
UPDATE "specialties"
SET    "code" = 'OBGYN',
       "name" = 'Obstetrics & Gynecology'
WHERE  "code" = 'GYN';

-- Back-fill visits that inherited the legacy code
UPDATE "visits"
SET    "specialty_code" = 'OBGYN'
WHERE  "specialty_code" = 'GYN';
