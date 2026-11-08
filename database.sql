CREATE DATABASE IF NOT EXISTS bengkel
CHARACTER SET utf8mb4;

USE bengkel;

CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('customer','admin') NOT NULL DEFAULT 'customer',
    tgl_daftar TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS partner_workshops (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    owner_user_id INT UNSIGNED NOT NULL,
    name VARCHAR(160) NOT NULL,
    address VARCHAR(500) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    lat DECIMAL(10,7) NOT NULL,
    lng DECIMAL(10,7) NOT NULL,
    services JSON NOT NULL,
    pickup BOOLEAN NOT NULL DEFAULT FALSE,
    onsite BOOLEAN NOT NULL DEFAULT FALSE,
    emergency BOOLEAN NOT NULL DEFAULT FALSE,
    open24 BOOLEAN NOT NULL DEFAULT FALSE,
    status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    google_place_id VARCHAR(255) UNIQUE NULL,
    reviewed_by INT UNSIGNED NULL,
    reviewed_at TIMESTAMP NULL,
    review_note VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_partner_status (status),
    INDEX idx_partner_owner (owner_user_id),
    CONSTRAINT fk_partner_owner FOREIGN KEY (owner_user_id) REFERENCES users(id),
    CONSTRAINT fk_partner_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id)
);
