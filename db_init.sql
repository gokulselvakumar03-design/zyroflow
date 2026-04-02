CREATE TABLE IF NOT EXISTS workflow_requests (
id INT AUTO_INCREMENT PRIMARY KEY,
title VARCHAR(255),
type VARCHAR(100),
description TEXT,
amount INT,
status VARCHAR(50),
currentRole VARCHAR(50),
current_level INT DEFAULT 0,
workflow TEXT,
createdAt BIGINT,
deadline BIGINT,
escalated BOOLEAN DEFAULT FALSE,
fileName VARCHAR(255),
payload JSON NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS requests (
id INT AUTO_INCREMENT PRIMARY KEY,
employee_id INT,
request_type VARCHAR(100),
amount DECIMAL(12,2) DEFAULT 0,
description TEXT,
status VARCHAR(50) DEFAULT 'pending',
current_step INT DEFAULT 1,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approvals (
id INT AUTO_INCREMENT PRIMARY KEY,
request_id INT,
approver_role VARCHAR(50),
step INT,
status VARCHAR(50),
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (request_id) REFERENCES workflow_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS request_history (
id INT AUTO_INCREMENT PRIMARY KEY,
request_id INT,
action VARCHAR(100),
user VARCHAR(100),
performed_by VARCHAR(100),
timestamp BIGINT,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (request_id) REFERENCES workflow_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
id INT AUTO_INCREMENT PRIMARY KEY,
name VARCHAR(100),
email VARCHAR(100) UNIQUE,
password VARCHAR(100),
role VARCHAR(50)
);

ALTER TABLE workflow_requests
MODIFY id INT AUTO_INCREMENT;

INSERT IGNORE INTO users (name, email, password, role) VALUES
('Admin', 'admin@zyroflow.com', 'admin123', 'admin'),
('Accounts', 'accounts@zyroflow.com', 'acc123', 'accounts'),
('Manager', 'manager@zyroflow.com', 'man123', 'manager'),
('CFO', 'cfo@zyroflow.com', 'cfo123', 'cfo'),
('MD', 'md@zyroflow.com', 'md123', 'md'),
('Employee One', 'employee1@zyroflow.com', 'emp123', 'employee');

SELECT * FROM users;
SELECT * FROM workflow_requests;
SELECT * FROM approvals;
SELECT * FROM request_history;
