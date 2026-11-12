CREATE TABLE IF NOT EXISTS partner_workshop_details (
 workshop_id INT UNSIGNED PRIMARY KEY,
 details JSON NOT NULL,
 terms_version VARCHAR(30) NOT NULL,
 accepted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_details_workshop FOREIGN KEY(workshop_id) REFERENCES partner_workshops(id) ON DELETE CASCADE
);
