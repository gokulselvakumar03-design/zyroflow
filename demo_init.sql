-- Schema for Isolated Demo Database (zyroflow_demo)
-- Includes demo_session_id scoping for multi-tenant concurrent demo sessions

CREATE DATABASE IF NOT EXISTS `zyroflow_demo`;
USE `zyroflow_demo`;

SET FOREIGN_KEY_CHECKS = 0;

-- 1. workflow_requests table
CREATE TABLE IF NOT EXISTS workflow_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
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
  approval_stage VARCHAR(100) DEFAULT 'Accounts',
  workflow TEXT,
  payload JSON NULL,
  current_level INT DEFAULT 0,
  payment_verified INT DEFAULT 0,
  payment_verified_by VARCHAR(100) NULL,
  payment_verified_at TIMESTAMP NULL,
  payment_verification_status VARCHAR(50) DEFAULT 'Unverified',
  rejection_reason TEXT NULL,
  comments TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_demo_session (demo_session_id),
  INDEX idx_req_status (status),
  INDEX idx_req_stage (approval_stage)
);

-- 2. approvals table
CREATE TABLE IF NOT EXISTS approvals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
  request_id INT NOT NULL,
  approver_role VARCHAR(50),
  step INT,
  status VARCHAR(50),
  comments TEXT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_demo_session (demo_session_id),
  INDEX idx_appr_req (request_id),
  INDEX idx_appr_role (approver_role),
  FOREIGN KEY (request_id) REFERENCES workflow_requests(id) ON DELETE CASCADE
);

-- 3. rules table
CREATE TABLE IF NOT EXISTS rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
  request_type VARCHAR(100),
  min_amount DECIMAL(12,2) DEFAULT 0,
  max_amount DECIMAL(12,2) DEFAULT 0,
  approvers TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_demo_session (demo_session_id)
);

-- 4. users table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
  employee_id VARCHAR(20) NOT NULL,
  name VARCHAR(100),
  email VARCHAR(100) NOT NULL,
  password VARCHAR(255),
  role VARCHAR(50),
  phone VARCHAR(20),
  department VARCHAR(100),
  profile_image VARCHAR(255),
  status VARCHAR(20) DEFAULT 'ACTIVE',
  recovery_email VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_demo_session (demo_session_id),
  UNIQUE KEY uq_emp_session (employee_id, demo_session_id),
  UNIQUE KEY uq_email_session (email, demo_session_id)
);

-- 5. approval_history table
CREATE TABLE IF NOT EXISTS approval_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
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
  INDEX idx_demo_session (demo_session_id),
  INDEX idx_ah_req (request_id),
  INDEX idx_ah_stage (approval_stage)
);

-- 6. payment_verifications table
CREATE TABLE IF NOT EXISTS payment_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
  request_id INT NOT NULL,
  verified_by VARCHAR(100) NOT NULL,
  verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  remarks TEXT,
  status VARCHAR(50) DEFAULT 'Verified',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_demo_session (demo_session_id),
  INDEX idx_pv_req (request_id),
  INDEX idx_pv_status (status),
  FOREIGN KEY (request_id) REFERENCES workflow_requests(id) ON DELETE CASCADE
);

-- 7. notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
  user_role VARCHAR(50) DEFAULT 'accounts',
  user_email VARCHAR(100) NULL,
  request_id INT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'info',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_demo_session (demo_session_id),
  INDEX idx_notif_user (user_email, user_role)
);

-- 8. draft_requests table
CREATE TABLE IF NOT EXISTS draft_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
  employee_id VARCHAR(100) NOT NULL,
  request_type VARCHAR(100),
  department VARCHAR(100),
  priority VARCHAR(50),
  payload JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_demo_session (demo_session_id),
  INDEX idx_draft_emp (employee_id)
);

-- 9. request_history table
CREATE TABLE IF NOT EXISTS request_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
  request_id BIGINT,
  action VARCHAR(255),
  performed_by VARCHAR(100),
  comments TEXT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_demo_session (demo_session_id),
  INDEX idx_rh_req (request_id)
);

-- 10. password_reset_tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  demo_session_id VARCHAR(64) NOT NULL DEFAULT 'default',
  user_id INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_demo_session (demo_session_id),
  INDEX idx_token_hash (token_hash),
  INDEX idx_user_id (user_id)
);

SET FOREIGN_KEY_CHECKS = 1;
