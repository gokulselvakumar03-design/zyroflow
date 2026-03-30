CREATE TABLE IF NOT EXISTS request_history (
id INT AUTO_INCREMENT PRIMARY KEY,
request_id INT,
action VARCHAR(100),
performed_by VARCHAR(100),
timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
id INT AUTO_INCREMENT PRIMARY KEY,
name VARCHAR(100),
email VARCHAR(100) UNIQUE,
password VARCHAR(100),
role VARCHAR(50)
);

INSERT IGNORE INTO users (name, email, password, role) VALUES
('Admin', 'admin@zyroflow.com', 'admin123', 'admin'),
('Accounts', 'accounts@zyroflow.com', 'acc123', 'accounts'),
('Manager', 'manager@zyroflow.com', 'man123', 'manager'),
('CFO', 'cfo@zyroflow.com', 'cfo123', 'cfo'),
('MD', 'md@zyroflow.com', 'md123', 'md'),
('Employee One', 'employee1@zyroflow.com', 'emp123', 'employee');
