-- Core Tables for Multi-Level Approval Workflow System

CREATE TABLE IF NOT EXISTS workflow_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255),
  type VARCHAR(100),
  description TEXT,
  amount INT,
  department VARCHAR(100),
  priority VARCHAR(50),
  status VARCHAR(50),
  requester_name VARCHAR(100),
  requester_email VARCHAR(100),
  current_role VARCHAR(50),
  current_approver VARCHAR(100),
  workflow TEXT,
  payload JSON NULL,
  current_level INT DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_type VARCHAR(100),
  min_amount DECIMAL(12,2) DEFAULT 0,
  max_amount DECIMAL(12,2) DEFAULT 0,
  approvers TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS request_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT,
  action VARCHAR(100),
  performed_by VARCHAR(100),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id VARCHAR(20) UNIQUE,
  name VARCHAR(100),
  email VARCHAR(100) UNIQUE,
  password VARCHAR(100),
  role VARCHAR(50),
  phone VARCHAR(20),
  department VARCHAR(100),
  profile_image VARCHAR(255),
  status VARCHAR(20) DEFAULT 'ACTIVE'
);
