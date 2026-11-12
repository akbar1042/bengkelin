CREATE TABLE IF NOT EXISTS service_orders (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 customer_id INT UNSIGNED NOT NULL,
 workshop_id INT UNSIGNED NOT NULL,
 vehicle_type ENUM('motor','mobil') NOT NULL,
 service VARCHAR(160) NOT NULL,
 scheduled_at DATETIME NOT NULL,
 notes VARCHAR(1500) NOT NULL DEFAULT '',
 status ENUM('waiting','accepted','processing','completed','cancelled') NOT NULL DEFAULT 'waiting',
 cancellation_reason VARCHAR(500) NULL,
 confirmed_cost DECIMAL(12,0) NULL,
 cost_note VARCHAR(500) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX idx_order_customer(customer_id), INDEX idx_order_schedule(workshop_id,scheduled_at),
 FOREIGN KEY(customer_id) REFERENCES users(id), FOREIGN KEY(workshop_id) REFERENCES partner_workshops(id)
);
CREATE TABLE IF NOT EXISTS service_order_events (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, order_id INT UNSIGNED NOT NULL,
 actor_id INT UNSIGNED NOT NULL, status VARCHAR(20) NOT NULL, note VARCHAR(500) NOT NULL DEFAULT '',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(order_id) REFERENCES service_orders(id) ON DELETE CASCADE,
 FOREIGN KEY(actor_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS workshop_favorites (
 user_id INT UNSIGNED NOT NULL, workshop_id INT UNSIGNED NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,workshop_id), FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(workshop_id) REFERENCES partner_workshops(id)
);
CREATE TABLE IF NOT EXISTS service_reviews (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, order_id INT UNSIGNED NOT NULL UNIQUE,
 customer_id INT UNSIGNED NOT NULL, workshop_id INT UNSIGNED NOT NULL,
 rating TINYINT UNSIGNED NOT NULL, content VARCHAR(1500) NOT NULL,
 status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
 moderation_note VARCHAR(500) NULL, moderated_by INT UNSIGNED NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(order_id) REFERENCES service_orders(id), FOREIGN KEY(customer_id) REFERENCES users(id),
 FOREIGN KEY(workshop_id) REFERENCES partner_workshops(id), FOREIGN KEY(moderated_by) REFERENCES users(id)
);
