CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  email_verified_at TIMESTAMP NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(255) NOT NULL DEFAULT 'admin',
  photo_path VARCHAR(255) NULL,
  remember_token VARCHAR(100) NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  email VARCHAR(255) PRIMARY KEY,
  token VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_code VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  father_name VARCHAR(255) NULL,
  phone VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  tazkira_or_passport VARCHAR(255) NULL,
  company_name VARCHAR(255) NULL,
  address TEXT NULL,
  notes TEXT NULL,
  photo_path VARCHAR(255) NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  INDEX idx_customers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cargo_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  cargo_code VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(255) NULL,
  brand VARCHAR(255) NULL,
  carton_count INT UNSIGNED NOT NULL DEFAULT 0,
  length_cm DECIMAL(10,2) NOT NULL DEFAULT 0,
  width_cm DECIMAL(10,2) NOT NULL DEFAULT 0,
  height_cm DECIMAL(10,2) NOT NULL DEFAULT 0,
  cbm_per_carton DECIMAL(12,6) NOT NULL DEFAULT 0,
  total_cbm DECIMAL(12,4) NOT NULL DEFAULT 0,
  gross_weight_kg DECIMAL(12,2) NOT NULL DEFAULT 0,
  value_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(255) NOT NULL DEFAULT 'registered',
  description TEXT NULL,
  billing_mode VARCHAR(255) NOT NULL DEFAULT 'itemized',
  contract_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  contract_currency VARCHAR(255) NOT NULL DEFAULT 'USD',
  commission_percent DECIMAL(8,2) NOT NULL DEFAULT 0,
  contract_route VARCHAR(255) NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  INDEX idx_cargo_items_customer_id (customer_id),
  INDEX idx_cargo_items_status (status),
  INDEX idx_cargo_items_created_at (created_at),
  CONSTRAINT fk_cargo_items_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS weighbridge_tickets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_no VARCHAR(255) NOT NULL UNIQUE,
  customer_id BIGINT UNSIGNED NULL,
  cargo_item_id BIGINT UNSIGNED NULL,
  vehicle_plate VARCHAR(255) NULL,
  driver_name VARCHAR(255) NULL,
  driver_phone VARCHAR(255) NULL,
  first_weight_kg DECIMAL(12,2) NOT NULL DEFAULT 0,
  second_weight_kg DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_weight_kg DECIMAL(12,2) NOT NULL DEFAULT 0,
  carton_count INT UNSIGNED NOT NULL DEFAULT 0,
  weigh_type VARCHAR(255) NOT NULL DEFAULT 'loading',
  first_weight_at TIMESTAMP NULL,
  second_weight_at TIMESTAMP NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  INDEX idx_tickets_customer_id (customer_id),
  INDEX idx_tickets_cargo_item_id (cargo_item_id),
  INDEX idx_tickets_created_at (created_at),
  CONSTRAINT fk_tickets_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT fk_tickets_cargo FOREIGN KEY (cargo_item_id) REFERENCES cargo_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shipping_containers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  container_no VARCHAR(255) NOT NULL UNIQUE,
  seal_no VARCHAR(255) NULL,
  booking_no VARCHAR(255) NULL,
  ship_name VARCHAR(255) NULL,
  container_type VARCHAR(255) NOT NULL DEFAULT '40HQ',
  origin VARCHAR(255) NULL,
  destination VARCHAR(255) NULL,
  current_location VARCHAR(255) NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'draft',
  departure_date DATE NULL,
  arrival_date DATE NULL,
  freight_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  freight_currency VARCHAR(255) NOT NULL DEFAULT 'USD',
  total_loaded_cbm DECIMAL(12,4) NOT NULL DEFAULT 0,
  freight_per_cbm_usd DECIMAL(12,4) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  INDEX idx_shipping_containers_status (status),
  INDEX idx_shipping_containers_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS container_cargo_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shipping_container_id BIGINT UNSIGNED NOT NULL,
  cargo_item_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  cartons_loaded INT UNSIGNED NOT NULL DEFAULT 0,
  cbm_loaded DECIMAL(12,4) NOT NULL DEFAULT 0,
  weight_loaded_kg DECIMAL(12,2) NOT NULL DEFAULT 0,
  freight_share_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  INDEX idx_cci_container (shipping_container_id),
  INDEX idx_cci_cargo (cargo_item_id),
  INDEX idx_cci_customer (customer_id),
  CONSTRAINT fk_cci_container FOREIGN KEY (shipping_container_id) REFERENCES shipping_containers(id) ON DELETE CASCADE,
  CONSTRAINT fk_cci_cargo FOREIGN KEY (cargo_item_id) REFERENCES cargo_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_cci_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS expenses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  expense_no VARCHAR(255) NOT NULL UNIQUE,
  scope VARCHAR(255) NOT NULL DEFAULT 'company',
  customer_id BIGINT UNSIGNED NULL,
  cargo_item_id BIGINT UNSIGNED NULL,
  shipping_container_id BIGINT UNSIGNED NULL,
  vehicle_trip_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(255) NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(255) NOT NULL DEFAULT 'USD',
  rate_to_usd DECIMAL(12,4) NOT NULL DEFAULT 1,
  amount_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  expense_date DATE NULL,
  notes TEXT NULL,
  route_from VARCHAR(255) NULL,
  route_to VARCHAR(255) NULL,
  billable_to_customer TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  INDEX idx_expenses_scope (scope),
  INDEX idx_expenses_customer_id (customer_id),
  INDEX idx_expenses_cargo_item_id (cargo_item_id),
  INDEX idx_expenses_container_id (shipping_container_id),
  INDEX idx_expenses_created_at (created_at),
  CONSTRAINT fk_expenses_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT fk_expenses_cargo FOREIGN KEY (cargo_item_id) REFERENCES cargo_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_expenses_container FOREIGN KEY (shipping_container_id) REFERENCES shipping_containers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cargo_locations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transport_type VARCHAR(255) NOT NULL DEFAULT 'container',
  transport_no VARCHAR(255) NULL,
  shipping_container_id BIGINT UNSIGNED NULL,
  cargo_item_id BIGINT UNSIGNED NULL,
  stage VARCHAR(255) NULL,
  location_name VARCHAR(255) NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'waiting',
  arrived_at DATETIME NULL,
  departed_at DATETIME NULL,
  cost_usd DECIMAL(15,2) NOT NULL DEFAULT 0,
  cost_currency VARCHAR(255) NOT NULL DEFAULT 'USD',
  notes TEXT NULL,
  route_from VARCHAR(255) NULL,
  route_to VARCHAR(255) NULL,
  expense_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  INDEX idx_cargo_locations_container_id (shipping_container_id),
  INDEX idx_cargo_locations_cargo_item_id (cargo_item_id),
  INDEX idx_cargo_locations_status (status),
  INDEX idx_cargo_locations_created_at (created_at),
  CONSTRAINT fk_locations_container FOREIGN KEY (shipping_container_id) REFERENCES shipping_containers(id) ON DELETE SET NULL,
  CONSTRAINT fk_locations_cargo FOREIGN KEY (cargo_item_id) REFERENCES cargo_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_boxes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL DEFAULT 'صندوق اصلی',
  currency VARCHAR(255) NOT NULL DEFAULT 'USD',
  opening_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  notes TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cash_box_id BIGINT UNSIGNED NOT NULL,
  transaction_no VARCHAR(255) NOT NULL UNIQUE,
  type VARCHAR(255) NOT NULL DEFAULT 'income',
  title VARCHAR(255) NOT NULL,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  currency VARCHAR(255) NOT NULL DEFAULT 'USD',
  rate_to_usd DECIMAL(15,4) NOT NULL DEFAULT 1,
  amount_usd DECIMAL(15,2) NOT NULL DEFAULT 0,
  transaction_date DATE NULL,
  source_type VARCHAR(255) NULL DEFAULT 'manual',
  expense_id BIGINT UNSIGNED NULL,
  payment_id BIGINT UNSIGNED NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  INDEX idx_cash_transactions_box_type (cash_box_id,type),
  INDEX idx_cash_transactions_date (transaction_date),
  INDEX idx_cash_transactions_expense_id (expense_id),
  INDEX idx_cash_transactions_payment_id (payment_id),
  CONSTRAINT fk_cash_tx_box FOREIGN KEY (cash_box_id) REFERENCES cash_boxes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  payment_no VARCHAR(255) NOT NULL UNIQUE,
  customer_id BIGINT UNSIGNED NOT NULL,
  shipping_container_id BIGINT UNSIGNED NULL,
  cargo_item_id BIGINT UNSIGNED NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(255) NOT NULL DEFAULT 'USD',
  rate_to_usd DECIMAL(12,4) NOT NULL DEFAULT 1,
  amount_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_date DATE NULL,
  payment_method VARCHAR(255) NULL DEFAULT 'cash',
  notes TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  INDEX idx_payments_customer_id (customer_id),
  INDEX idx_payments_container_id (shipping_container_id),
  INDEX idx_payments_cargo_item_id (cargo_item_id),
  INDEX idx_payments_created_at (created_at),
  CONSTRAINT fk_payments_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_container FOREIGN KEY (shipping_container_id) REFERENCES shipping_containers(id) ON DELETE SET NULL,
  CONSTRAINT fk_payments_cargo FOREIGN KEY (cargo_item_id) REFERENCES cargo_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_permissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  page_key VARCHAR(64) NOT NULL,
  can_access TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  UNIQUE KEY uk_user_page (user_id, page_key),
  CONSTRAINT fk_user_permissions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  module VARCHAR(255) NULL,
  module_name VARCHAR(255) NULL,
  action VARCHAR(255) NULL,
  description TEXT NULL,
  properties JSON NULL,
  ip_address VARCHAR(255) NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  INDEX idx_activity_user (user_id),
  CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_settings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(255) NOT NULL UNIQUE,
  `value` TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(255) PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  ip_address VARCHAR(45) NULL,
  user_agent TEXT NULL,
  payload LONGTEXT NOT NULL,
  last_activity INT NOT NULL,
  INDEX idx_sessions_user (user_id),
  INDEX idx_sessions_last_activity (last_activity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS express_sessions (
  session_id VARCHAR(128) NOT NULL,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT NULL,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vehicle_code VARCHAR(255) NOT NULL UNIQUE,
  plate_no VARCHAR(255) NOT NULL,
  vehicle_type VARCHAR(255) NULL DEFAULT 'truck',
  brand_model VARCHAR(255) NULL,
  capacity_kg DECIMAL(12,2) NOT NULL DEFAULT 0,
  capacity_cbm DECIMAL(12,4) NOT NULL DEFAULT 0,
  owner_name VARCHAR(255) NULL,
  default_driver_name VARCHAR(255) NULL,
  default_driver_phone VARCHAR(255) NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'active',
  notes TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  INDEX idx_vehicles_plate (plate_no),
  INDEX idx_vehicles_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_trips (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trip_no VARCHAR(255) NOT NULL UNIQUE,
  vehicle_id BIGINT UNSIGNED NOT NULL,
  driver_name VARCHAR(255) NULL,
  driver_phone VARCHAR(255) NULL,
  origin VARCHAR(255) NULL,
  destination VARCHAR(255) NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'loading',
  loaded_at DATETIME NULL,
  departed_at DATETIME NULL,
  arrived_at DATETIME NULL,
  delivered_at DATETIME NULL,
  freight_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  freight_currency VARCHAR(255) NOT NULL DEFAULT 'USD',
  total_weight_kg DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  INDEX idx_vehicle_trips_vehicle (vehicle_id),
  INDEX idx_vehicle_trips_status (status),
  CONSTRAINT fk_vehicle_trips_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_trip_cargo (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vehicle_trip_id BIGINT UNSIGNED NOT NULL,
  cargo_item_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  cartons INT UNSIGNED NOT NULL DEFAULT 0,
  weight_kg DECIMAL(12,2) NOT NULL DEFAULT 0,
  freight_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  freight_currency VARCHAR(255) NOT NULL DEFAULT 'USD',
  notes TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  INDEX idx_vtc_trip (vehicle_trip_id),
  INDEX idx_vtc_cargo (cargo_item_id),
  CONSTRAINT fk_vtc_trip FOREIGN KEY (vehicle_trip_id) REFERENCES vehicle_trips(id) ON DELETE CASCADE,
  CONSTRAINT fk_vtc_cargo FOREIGN KEY (cargo_item_id) REFERENCES cargo_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_vtc_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_trip_expenses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vehicle_trip_id BIGINT UNSIGNED NOT NULL,
  expense_id BIGINT UNSIGNED NULL,
  stage VARCHAR(255) NOT NULL DEFAULT 'transit',
  title VARCHAR(255) NOT NULL,
  expense_date DATE NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(255) NOT NULL DEFAULT 'USD',
  rate_to_usd DECIMAL(12,4) NOT NULL DEFAULT 1,
  amount_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  INDEX idx_vte_trip (vehicle_trip_id),
  INDEX idx_vte_date (expense_date),
  CONSTRAINT fk_vte_trip FOREIGN KEY (vehicle_trip_id) REFERENCES vehicle_trips(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deliveries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  delivery_no VARCHAR(255) NOT NULL UNIQUE,
  vehicle_trip_id BIGINT UNSIGNED NULL,
  customer_id BIGINT UNSIGNED NULL,
  cargo_item_id BIGINT UNSIGNED NULL,
  delivered_at DATETIME NULL,
  recipient_name VARCHAR(255) NULL,
  recipient_phone VARCHAR(255) NULL,
  cartons_delivered INT UNSIGNED NOT NULL DEFAULT 0,
  weight_kg DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(255) NOT NULL DEFAULT 'delivered',
  notes TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  INDEX idx_deliveries_trip (vehicle_trip_id),
  INDEX idx_deliveries_customer (customer_id),
  CONSTRAINT fk_deliveries_trip FOREIGN KEY (vehicle_trip_id) REFERENCES vehicle_trips(id) ON DELETE SET NULL,
  CONSTRAINT fk_deliveries_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT fk_deliveries_cargo FOREIGN KEY (cargo_item_id) REFERENCES cargo_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS partners (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  partner_code VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  share_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  equity_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  equity_currency VARCHAR(255) NOT NULL DEFAULT 'USD',
  notes TEXT NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS partner_withdrawals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  withdrawal_no VARCHAR(255) NOT NULL UNIQUE,
  partner_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(255) NOT NULL DEFAULT 'USD',
  rate_to_usd DECIMAL(12,4) NOT NULL DEFAULT 1,
  amount_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  withdrawal_date DATE NULL,
  notes TEXT NULL,
  cash_transaction_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  INDEX idx_pw_partner (partner_id),
  CONSTRAINT fk_pw_partner FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salary_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  salary_no VARCHAR(255) NOT NULL UNIQUE,
  employee_name VARCHAR(255) NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(255) NOT NULL DEFAULT 'USD',
  rate_to_usd DECIMAL(12,4) NOT NULL DEFAULT 1,
  amount_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  salary_month VARCHAR(7) NULL,
  paid_date DATE NULL,
  category VARCHAR(255) NULL DEFAULT 'salary',
  notes TEXT NULL,
  expense_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  INDEX idx_salary_month (salary_month),
  CONSTRAINT fk_salary_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
