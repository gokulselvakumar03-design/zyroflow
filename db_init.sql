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
  `current_role` VARCHAR(50),
  current_approver VARCHAR(100),
  approval_stage VARCHAR(100) DEFAULT 'Accounts',
  workflow TEXT,
  payload JSON NULL,
  current_level INT DEFAULT 0,
  payment_verified INT DEFAULT 0,
  payment_verified_by VARCHAR(100) NULL,
  payment_verified_at TIMESTAMP NULL,
  payment_verification_status VARCHAR(50) DEFAULT 'Unverified',
  rejection_reason TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approvals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT,
  approver_role VARCHAR(50),
  step INT,
  status VARCHAR(50),
  comments TEXT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id VARCHAR(20) UNIQUE,
  name VARCHAR(100),
  email VARCHAR(150) NULL,
  password VARCHAR(255),
  role VARCHAR(50),
  phone VARCHAR(20),
  department VARCHAR(100),
  profile_image VARCHAR(255),
  status VARCHAR(20) DEFAULT 'ACTIVE',
  account_type VARCHAR(50) NULL,
  recovery_email VARCHAR(255) NULL
);

CREATE TABLE IF NOT EXISTS approval_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  employee_name VARCHAR(100),
  department VARCHAR(100),
  request_type VARCHAR(100),
  amount DECIMAL(12,2) DEFAULT 0.00,
  priority VARCHAR(50) DEFAULT 'MEDIUM',
  manager_name VARCHAR(100) DEFAULT 'Manager',
  approval_stage VARCHAR(50) DEFAULT 'Manager',
  decision VARCHAR(50) NOT NULL,
  action VARCHAR(50) NULL,
  decision_time INT DEFAULT 0,
  decision_time_seconds INT DEFAULT 0,
  decision_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  comments TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ah_req (request_id),
  INDEX idx_ah_stage (approval_stage)
);

CREATE TABLE IF NOT EXISTS payment_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  verified_by VARCHAR(100) NOT NULL,
  verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  remarks TEXT,
  status VARCHAR(50) DEFAULT 'Verified',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pv_req (request_id),
  INDEX idx_pv_status (status),
  FOREIGN KEY (request_id) REFERENCES workflow_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_role VARCHAR(50) DEFAULT 'accounts',
  user_email VARCHAR(100) NULL,
  request_id INT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'info',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS draft_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id VARCHAR(100) NOT NULL,
  request_type VARCHAR(100),
  department VARCHAR(100),
  priority VARCHAR(50),
  payload JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_draft_emp (employee_id)
);

CREATE TABLE IF NOT EXISTS request_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT,
  action VARCHAR(255),
  performed_by VARCHAR(100),
  comments TEXT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS demo_access (
  id INT AUTO_INCREMENT PRIMARY KEY,
  demo_session_id VARCHAR(64) NOT NULL,
  employee_id VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'Admin',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  status VARCHAR(20) DEFAULT 'ACTIVE',
  account_type VARCHAR(50) NULL,
  INDEX idx_demo_emp (employee_id),
  INDEX idx_demo_session (demo_session_id),
  INDEX idx_demo_status (status)
);
