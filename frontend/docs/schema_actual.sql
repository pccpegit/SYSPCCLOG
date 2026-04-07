BEGIN;
--
-- Create model User
--
CREATE TABLE "users" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "password" varchar(128) NOT NULL, "last_login" datetime NULL, "is_superuser" bool NOT NULL, "username" varchar(150) NOT NULL UNIQUE, "is_staff" bool NOT NULL, "is_active" bool NOT NULL, "date_joined" datetime NOT NULL, "email" varchar(254) NOT NULL UNIQUE, "first_name" varchar(100) NOT NULL, "last_name" varchar(100) NOT NULL, "position" varchar(100) NOT NULL, "department" varchar(100) NOT NULL, "phone" varchar(20) NOT NULL, "avatar_url" varchar(255) NOT NULL);
CREATE TABLE "users_groups" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "user_id" bigint NOT NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "group_id" integer NOT NULL REFERENCES "auth_group" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE "users_user_permissions" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "user_id" bigint NOT NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "permission_id" integer NOT NULL REFERENCES "auth_permission" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model Department
--
CREATE TABLE "departments" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "code" varchar(20) NOT NULL UNIQUE, "name" varchar(200) NOT NULL, "is_active" bool NOT NULL, "created_at" datetime NOT NULL, "manager_id" bigint NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model AnnualPlan
--
CREATE TABLE "annual_plans" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "year" integer unsigned NOT NULL CHECK ("year" >= 0), "total_budget" decimal NOT NULL, "approved_at" datetime NULL, "is_active" bool NOT NULL, "created_at" datetime NOT NULL, "approved_by_id" bigint NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "department_id" bigint NOT NULL REFERENCES "departments" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model Project
--
CREATE TABLE "projects" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "created_at" datetime NOT NULL, "updated_at" datetime NOT NULL, "code" varchar(20) NOT NULL UNIQUE, "name" varchar(200) NOT NULL, "location" varchar(200) NOT NULL, "client" varchar(200) NOT NULL, "total_budget" decimal NULL, "start_date" date NULL, "end_date" date NULL, "is_active" bool NOT NULL);
--
-- Create model AnnualPlanLine
--
CREATE TABLE "annual_plan_lines" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "code" varchar(50) NOT NULL, "description" varchar(300) NOT NULL, "category" varchar(100) NOT NULL, "budgeted_amount" decimal NOT NULL, "committed_amount" decimal NOT NULL, "spent_amount" decimal NOT NULL, "created_at" datetime NOT NULL, "annual_plan_id" bigint NOT NULL REFERENCES "annual_plans" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model ProjectBudgetLine
--
CREATE TABLE "project_budget_lines" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "code" varchar(50) NOT NULL, "description" varchar(300) NOT NULL, "budgeted_amount" decimal NOT NULL, "committed_amount" decimal NOT NULL, "spent_amount" decimal NOT NULL, "created_at" datetime NOT NULL, "project_id" bigint NOT NULL REFERENCES "projects" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model UserRole
--
CREATE TABLE "user_roles" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "role" varchar(30) NOT NULL, "flow" varchar(20) NULL, "is_primary" bool NOT NULL, "assigned_at" datetime NOT NULL, "department_obj_id" bigint NULL REFERENCES "departments" ("id") DEFERRABLE INITIALLY DEFERRED, "project_id" bigint NULL REFERENCES "projects" ("id") DEFERRABLE INITIALLY DEFERRED, "user_id" bigint NOT NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED);
CREATE UNIQUE INDEX "users_groups_user_id_group_id_fc7788e8_uniq" ON "users_groups" ("user_id", "group_id");
CREATE INDEX "users_groups_user_id_f500bee5" ON "users_groups" ("user_id");
CREATE INDEX "users_groups_group_id_2f3517aa" ON "users_groups" ("group_id");
CREATE UNIQUE INDEX "users_user_permissions_user_id_permission_id_3b86cbdf_uniq" ON "users_user_permissions" ("user_id", "permission_id");
CREATE INDEX "users_user_permissions_user_id_92473840" ON "users_user_permissions" ("user_id");
CREATE INDEX "users_user_permissions_permission_id_6d08dcd2" ON "users_user_permissions" ("permission_id");
CREATE INDEX "departments_manager_id_326f7904" ON "departments" ("manager_id");
CREATE UNIQUE INDEX "annual_plans_year_department_id_12c77a0d_uniq" ON "annual_plans" ("year", "department_id");
CREATE INDEX "annual_plans_approved_by_id_48920b64" ON "annual_plans" ("approved_by_id");
CREATE INDEX "annual_plans_department_id_69247acc" ON "annual_plans" ("department_id");
CREATE INDEX "projects_created_at_2184aeba" ON "projects" ("created_at");
CREATE INDEX "projects_is_acti_3457d5_idx" ON "projects" ("is_active");
CREATE INDEX "projects_code_7205ea_idx" ON "projects" ("code");
CREATE UNIQUE INDEX "annual_plan_lines_annual_plan_id_code_d593cbbe_uniq" ON "annual_plan_lines" ("annual_plan_id", "code");
CREATE INDEX "annual_plan_lines_annual_plan_id_7e873c66" ON "annual_plan_lines" ("annual_plan_id");
CREATE UNIQUE INDEX "project_budget_lines_project_id_code_e2f1d37f_uniq" ON "project_budget_lines" ("project_id", "code");
CREATE INDEX "project_budget_lines_project_id_1b2af3f9" ON "project_budget_lines" ("project_id");
CREATE INDEX "project_bud_project_389efa_idx" ON "project_budget_lines" ("project_id", "code");
CREATE UNIQUE INDEX "user_roles_user_id_role_project_id_department_obj_id_b426b0b1_uniq" ON "user_roles" ("user_id", "role", "project_id", "department_obj_id");
CREATE INDEX "user_roles_department_obj_id_0dcb62bb" ON "user_roles" ("department_obj_id");
CREATE INDEX "user_roles_project_id_322501f8" ON "user_roles" ("project_id");
CREATE INDEX "user_roles_user_id_9d9f8dbb" ON "user_roles" ("user_id");
CREATE INDEX "user_roles_user_id_aae85d_idx" ON "user_roles" ("user_id", "role");
CREATE INDEX "user_roles_role_c1a65b_idx" ON "user_roles" ("role", "flow");
COMMIT;
BEGIN;
--
-- Add field frente to department
--
CREATE TABLE "new__departments" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "frente" varchar(200) NOT NULL, "code" varchar(20) NOT NULL UNIQUE, "name" varchar(200) NOT NULL, "is_active" bool NOT NULL, "created_at" datetime NOT NULL, "manager_id" bigint NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED);
INSERT INTO "new__departments" ("id", "code", "name", "is_active", "created_at", "manager_id", "frente") SELECT "id", "code", "name", "is_active", "created_at", "manager_id", 'OFICINA CENTRAL' FROM "departments";
DROP TABLE "departments";
ALTER TABLE "new__departments" RENAME TO "departments";
CREATE INDEX "departments_manager_id_326f7904" ON "departments" ("manager_id");
--
-- Add field frente to project
--
CREATE TABLE "new__projects" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "created_at" datetime NOT NULL, "updated_at" datetime NOT NULL, "code" varchar(20) NOT NULL UNIQUE, "name" varchar(200) NOT NULL, "location" varchar(200) NOT NULL, "client" varchar(200) NOT NULL, "total_budget" decimal NULL, "start_date" date NULL, "end_date" date NULL, "is_active" bool NOT NULL, "frente" varchar(200) NOT NULL);
INSERT INTO "new__projects" ("id", "created_at", "updated_at", "code", "name", "location", "client", "total_budget", "start_date", "end_date", "is_active", "frente") SELECT "id", "created_at", "updated_at", "code", "name", "location", "client", "total_budget", "start_date", "end_date", "is_active", '' FROM "projects";
DROP TABLE "projects";
ALTER TABLE "new__projects" RENAME TO "projects";
CREATE INDEX "projects_created_at_2184aeba" ON "projects" ("created_at");
CREATE INDEX "projects_is_acti_3457d5_idx" ON "projects" ("is_active");
CREATE INDEX "projects_code_7205ea_idx" ON "projects" ("code");
COMMIT;
BEGIN;
--
-- Create model AcquisitionTypeConfig
--
CREATE TABLE "acquisition_type_config" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "type" varchar(20) NOT NULL UNIQUE, "min_days" integer unsigned NOT NULL CHECK ("min_days" >= 0), "max_days" integer unsigned NOT NULL CHECK ("max_days" >= 0), "max_extended_days" integer unsigned NULL CHECK ("max_extended_days" >= 0), "requires_gm_approval" bool NOT NULL, "requires_admin_approval" bool NOT NULL, "requires_project_manager_approval" bool NOT NULL, "requires_cost_control_approval" bool NOT NULL, "notes" text NOT NULL);
--
-- Create model Request
--
CREATE TABLE "requests" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "created_at" datetime NOT NULL, "updated_at" datetime NOT NULL, "rq_number" varchar(20) NOT NULL UNIQUE, "flow" varchar(20) NOT NULL, "front_area" varchar(100) NOT NULL, "service" varchar(100) NOT NULL, "specific_use" varchar(300) NOT NULL, "description" text NOT NULL, "justification" text NOT NULL, "acquisition_type" varchar(20) NOT NULL, "priority" varchar(10) NOT NULL, "status" varchar(30) NOT NULL, "budget_classification" varchar(30) NULL, "estimated_cost" decimal NOT NULL, "final_cost" decimal NULL, "fecha_necesidad" date NOT NULL, "fecha_estimada_entrega" date NULL, "fecha_real_entrega" date NULL, "annual_plan_line_id" bigint NULL REFERENCES "annual_plan_lines" ("id") DEFERRABLE INITIALLY DEFERRED, "budget_line_id" bigint NULL REFERENCES "project_budget_lines" ("id") DEFERRABLE INITIALLY DEFERRED, "department_id" bigint NULL REFERENCES "departments" ("id") DEFERRABLE INITIALLY DEFERRED, "project_id" bigint NULL REFERENCES "projects" ("id") DEFERRABLE INITIALLY DEFERRED, "requested_by_id" bigint NOT NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model Quotation
--
CREATE TABLE "quotations" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "quotation_number" varchar(50) NOT NULL, "total_amount" decimal NOT NULL, "currency" varchar(3) NOT NULL, "delivery_days" integer unsigned NULL CHECK ("delivery_days" >= 0), "payment_terms" varchar(200) NOT NULL, "validity_days" integer unsigned NULL CHECK ("validity_days" >= 0), "notes" text NOT NULL, "document_url" varchar(500) NOT NULL, "is_selected" bool NOT NULL, "selected_at" datetime NULL, "quoted_at" datetime NOT NULL, "created_at" datetime NOT NULL, "selected_by_id" bigint NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "request_id" bigint NOT NULL REFERENCES "requests" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model PurchaseOrder
--
CREATE TABLE "purchase_orders" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "created_at" datetime NOT NULL, "updated_at" datetime NOT NULL, "po_number" varchar(20) NOT NULL UNIQUE, "status" varchar(20) NOT NULL, "total_amount" decimal NOT NULL, "currency" varchar(3) NOT NULL, "payment_terms" varchar(200) NOT NULL, "expected_delivery_date" date NULL, "actual_delivery_date" date NULL, "document_url" varchar(500) NOT NULL, "notes" text NOT NULL, "generated_by_id" bigint NOT NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "quotation_id" bigint NOT NULL REFERENCES "quotations" ("id") DEFERRABLE INITIALLY DEFERRED, "request_id" bigint NOT NULL REFERENCES "requests" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model RequestItem
--
CREATE TABLE "request_items" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "line_number" integer unsigned NOT NULL CHECK ("line_number" >= 0), "description" varchar(300) NOT NULL, "specifications" text NOT NULL, "quantity" decimal NOT NULL, "unit" varchar(30) NOT NULL, "unit_price" decimal NULL, "total_price" decimal NULL, "stock_almacen_obra" decimal NOT NULL, "stock_almacen_central" decimal NOT NULL, "x_atender" decimal NULL, "presupuestado_adicional" varchar(20) NOT NULL, "rfi_fwo" varchar(50) NOT NULL, "estatus_guia" varchar(100) NOT NULL, "comentarios" text NOT NULL, "created_at" datetime NOT NULL, "request_id" bigint NOT NULL REFERENCES "requests" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model QuotationItem
--
CREATE TABLE "quotation_items" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "unit_price" decimal NOT NULL, "quantity" decimal NOT NULL, "total_price" decimal NOT NULL, "brand" varchar(100) NOT NULL, "model" varchar(100) NOT NULL, "notes" text NOT NULL, "created_at" datetime NOT NULL, "quotation_id" bigint NOT NULL REFERENCES "quotations" ("id") DEFERRABLE INITIALLY DEFERRED, "request_item_id" bigint NOT NULL REFERENCES "request_items" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model PurchaseOrderItem
--
CREATE TABLE "purchase_order_items" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "description" varchar(300) NOT NULL, "quantity" decimal NOT NULL, "unit" varchar(30) NOT NULL, "unit_price" decimal NOT NULL, "total_price" decimal NOT NULL, "created_at" datetime NOT NULL, "purchase_order_id" bigint NOT NULL REFERENCES "purchase_orders" ("id") DEFERRABLE INITIALLY DEFERRED, "quotation_item_id" bigint NULL REFERENCES "quotation_items" ("id") DEFERRABLE INITIALLY DEFERRED, "request_item_id" bigint NOT NULL REFERENCES "request_items" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model Supplier
--
CREATE TABLE "suppliers" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "ruc" varchar(11) NOT NULL UNIQUE, "business_name" varchar(200) NOT NULL, "trade_name" varchar(200) NOT NULL, "contact_name" varchar(100) NOT NULL, "contact_email" varchar(100) NOT NULL, "contact_phone" varchar(20) NOT NULL, "address" varchar(300) NOT NULL, "city" varchar(100) NOT NULL, "category" varchar(100) NOT NULL, "is_active" bool NOT NULL, "created_at" datetime NOT NULL);
--
-- Add field supplier to quotation
--
CREATE TABLE "new__quotations" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "quotation_number" varchar(50) NOT NULL, "total_amount" decimal NOT NULL, "currency" varchar(3) NOT NULL, "delivery_days" integer unsigned NULL CHECK ("delivery_days" >= 0), "payment_terms" varchar(200) NOT NULL, "validity_days" integer unsigned NULL CHECK ("validity_days" >= 0), "notes" text NOT NULL, "document_url" varchar(500) NOT NULL, "is_selected" bool NOT NULL, "selected_at" datetime NULL, "quoted_at" datetime NOT NULL, "created_at" datetime NOT NULL, "selected_by_id" bigint NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "request_id" bigint NOT NULL REFERENCES "requests" ("id") DEFERRABLE INITIALLY DEFERRED, "supplier_id" bigint NOT NULL REFERENCES "suppliers" ("id") DEFERRABLE INITIALLY DEFERRED);
INSERT INTO "new__quotations" ("id", "quotation_number", "total_amount", "currency", "delivery_days", "payment_terms", "validity_days", "notes", "document_url", "is_selected", "selected_at", "quoted_at", "created_at", "selected_by_id", "request_id", "supplier_id") SELECT "id", "quotation_number", "total_amount", "currency", "delivery_days", "payment_terms", "validity_days", "notes", "document_url", "is_selected", "selected_at", "quoted_at", "created_at", "selected_by_id", "request_id", NULL FROM "quotations";
DROP TABLE "quotations";
ALTER TABLE "new__quotations" RENAME TO "quotations";
CREATE INDEX "requests_created_at_f98e29a1" ON "requests" ("created_at");
CREATE INDEX "requests_status_68c95ac3" ON "requests" ("status");
CREATE INDEX "requests_annual_plan_line_id_c62a73ef" ON "requests" ("annual_plan_line_id");
CREATE INDEX "requests_budget_line_id_d7fe8823" ON "requests" ("budget_line_id");
CREATE INDEX "requests_department_id_e50881b0" ON "requests" ("department_id");
CREATE INDEX "requests_project_id_cfe45054" ON "requests" ("project_id");
CREATE INDEX "requests_requested_by_id_c18d5367" ON "requests" ("requested_by_id");
CREATE INDEX "purchase_orders_created_at_a7a7a87d" ON "purchase_orders" ("created_at");
CREATE INDEX "purchase_orders_generated_by_id_c328e665" ON "purchase_orders" ("generated_by_id");
CREATE INDEX "purchase_orders_quotation_id_acb5e384" ON "purchase_orders" ("quotation_id");
CREATE INDEX "purchase_orders_request_id_9b3d6cab" ON "purchase_orders" ("request_id");
CREATE UNIQUE INDEX "request_items_request_id_line_number_019f8973_uniq" ON "request_items" ("request_id", "line_number");
CREATE INDEX "request_items_request_id_d50406c2" ON "request_items" ("request_id");
CREATE INDEX "quotation_items_quotation_id_78b80273" ON "quotation_items" ("quotation_id");
CREATE INDEX "quotation_items_request_item_id_7304b08d" ON "quotation_items" ("request_item_id");
CREATE INDEX "purchase_order_items_purchase_order_id_0c2f986f" ON "purchase_order_items" ("purchase_order_id");
CREATE INDEX "purchase_order_items_quotation_item_id_42589d5c" ON "purchase_order_items" ("quotation_item_id");
CREATE INDEX "purchase_order_items_request_item_id_3ce06760" ON "purchase_order_items" ("request_item_id");
CREATE INDEX "suppliers_is_acti_a163b0_idx" ON "suppliers" ("is_active");
CREATE INDEX "suppliers_categor_8f4ffd_idx" ON "suppliers" ("category");
CREATE INDEX "quotations_selected_by_id_eb5e9d6a" ON "quotations" ("selected_by_id");
CREATE INDEX "quotations_request_id_f26244da" ON "quotations" ("request_id");
CREATE INDEX "quotations_supplier_id_c20c29f6" ON "quotations" ("supplier_id");
--
-- Add field supplier to purchaseorder
--
CREATE TABLE "new__purchase_orders" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "created_at" datetime NOT NULL, "updated_at" datetime NOT NULL, "po_number" varchar(20) NOT NULL UNIQUE, "status" varchar(20) NOT NULL, "total_amount" decimal NOT NULL, "currency" varchar(3) NOT NULL, "payment_terms" varchar(200) NOT NULL, "expected_delivery_date" date NULL, "actual_delivery_date" date NULL, "document_url" varchar(500) NOT NULL, "notes" text NOT NULL, "generated_by_id" bigint NOT NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "quotation_id" bigint NOT NULL REFERENCES "quotations" ("id") DEFERRABLE INITIALLY DEFERRED, "request_id" bigint NOT NULL REFERENCES "requests" ("id") DEFERRABLE INITIALLY DEFERRED, "supplier_id" bigint NOT NULL REFERENCES "suppliers" ("id") DEFERRABLE INITIALLY DEFERRED);
INSERT INTO "new__purchase_orders" ("id", "created_at", "updated_at", "po_number", "status", "total_amount", "currency", "payment_terms", "expected_delivery_date", "actual_delivery_date", "document_url", "notes", "generated_by_id", "quotation_id", "request_id", "supplier_id") SELECT "id", "created_at", "updated_at", "po_number", "status", "total_amount", "currency", "payment_terms", "expected_delivery_date", "actual_delivery_date", "document_url", "notes", "generated_by_id", "quotation_id", "request_id", NULL FROM "purchase_orders";
DROP TABLE "purchase_orders";
ALTER TABLE "new__purchase_orders" RENAME TO "purchase_orders";
CREATE INDEX "purchase_orders_created_at_a7a7a87d" ON "purchase_orders" ("created_at");
CREATE INDEX "purchase_orders_generated_by_id_c328e665" ON "purchase_orders" ("generated_by_id");
CREATE INDEX "purchase_orders_quotation_id_acb5e384" ON "purchase_orders" ("quotation_id");
CREATE INDEX "purchase_orders_request_id_9b3d6cab" ON "purchase_orders" ("request_id");
CREATE INDEX "purchase_orders_supplier_id_ea68c110" ON "purchase_orders" ("supplier_id");
--
-- Create model WorkflowStep
--
CREATE TABLE "workflow_steps" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "flow" varchar(20) NOT NULL, "step_order" integer unsigned NOT NULL CHECK ("step_order" >= 0), "step_code" varchar(50) NOT NULL, "step_name" varchar(200) NOT NULL, "responsible_role" varchar(30) NOT NULL, "from_status" varchar(30) NOT NULL, "to_status_approve" varchar(30) NOT NULL, "to_status_reject" varchar(30) NULL, "is_conditional" bool NOT NULL, "condition_description" text NOT NULL, "is_terminal_on_reject" bool NOT NULL, "phase" smallint unsigned NOT NULL CHECK ("phase" >= 0));
--
-- Add field current_step to request
--
ALTER TABLE "requests" ADD COLUMN "current_step_id" bigint NULL REFERENCES "workflow_steps" ("id") DEFERRABLE INITIALLY DEFERRED;
--
-- Create model Approval
--
CREATE TABLE "approvals" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "action" varchar(30) NOT NULL, "role" varchar(30) NOT NULL, "previous_status" varchar(30) NOT NULL, "new_status" varchar(30) NOT NULL, "comments" text NOT NULL, "performed_at" datetime NOT NULL, "performed_by_id" bigint NOT NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "request_id" bigint NOT NULL REFERENCES "requests" ("id") DEFERRABLE INITIALLY DEFERRED, "workflow_step_id" bigint NULL REFERENCES "workflow_steps" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model Notification
--
CREATE TABLE "notifications" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "title" varchar(200) NOT NULL, "message" text NOT NULL, "is_read" bool NOT NULL, "created_at" datetime NOT NULL, "user_id" bigint NOT NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "request_id" bigint NULL REFERENCES "requests" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model Claim
--
CREATE TABLE "claims" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "claim_type" varchar(20) NOT NULL, "status" varchar(15) NOT NULL, "description" text NOT NULL, "resolution" text NOT NULL, "created_at" datetime NOT NULL, "resolved_at" datetime NULL, "managed_by_id" bigint NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "raised_by_id" bigint NOT NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "resolved_by_id" bigint NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "request_id" bigint NOT NULL REFERENCES "requests" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model Attachment
--
CREATE TABLE "attachments" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "file_name" varchar(255) NOT NULL, "file_path" varchar(500) NOT NULL, "file_type" varchar(50) NOT NULL, "file_size" integer unsigned NULL CHECK ("file_size" >= 0), "category" varchar(50) NOT NULL, "description" varchar(300) NOT NULL, "uploaded_at" datetime NOT NULL, "uploaded_by_id" bigint NOT NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "request_id" bigint NOT NULL REFERENCES "requests" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model ActivityLog
--
CREATE TABLE "activity_log" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "action" varchar(100) NOT NULL, "detail" text NOT NULL, "ip_address" char(39) NULL, "created_at" datetime NOT NULL, "user_id" bigint NOT NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "request_id" bigint NOT NULL REFERENCES "requests" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create index quotations_request_102fc6_idx on field(s) request of model quotation
--
CREATE INDEX "quotations_request_102fc6_idx" ON "quotations" ("request_id");
--
-- Create index quotations_supplie_7830d8_idx on field(s) supplier of model quotation
--
CREATE INDEX "quotations_supplie_7830d8_idx" ON "quotations" ("supplier_id");
--
-- Create index quotations_is_sele_681d2e_idx on field(s) is_selected of model quotation
--
CREATE INDEX "quotations_is_sele_681d2e_idx" ON "quotations" ("is_selected");
--
-- Create index purchase_or_request_2e4737_idx on field(s) request of model purchaseorder
--
CREATE INDEX "purchase_or_request_2e4737_idx" ON "purchase_orders" ("request_id");
--
-- Create index purchase_or_supplie_d5a634_idx on field(s) supplier of model purchaseorder
--
CREATE INDEX "purchase_or_supplie_d5a634_idx" ON "purchase_orders" ("supplier_id");
--
-- Create index purchase_or_status_5ac239_idx on field(s) status of model purchaseorder
--
CREATE INDEX "purchase_or_status_5ac239_idx" ON "purchase_orders" ("status");
--
-- Create index requests_flow_d8d3f9_idx on field(s) flow of model request
--
CREATE INDEX "requests_flow_d8d3f9_idx" ON "requests" ("flow");
--
-- Create index requests_project_2ab1d3_idx on field(s) project of model request
--
CREATE INDEX "requests_project_2ab1d3_idx" ON "requests" ("project_id");
--
-- Create index requests_departm_4f445a_idx on field(s) department of model request
--
CREATE INDEX "requests_departm_4f445a_idx" ON "requests" ("department_id");
--
-- Create index requests_request_7f7978_idx on field(s) requested_by of model request
--
CREATE INDEX "requests_request_7f7978_idx" ON "requests" ("requested_by_id");
--
-- Create index requests_status_58d546_idx on field(s) status of model request
--
CREATE INDEX "requests_status_58d546_idx" ON "requests" ("status");
--
-- Create index requests_acquisi_d03fac_idx on field(s) acquisition_type of model request
--
CREATE INDEX "requests_acquisi_d03fac_idx" ON "requests" ("acquisition_type");
--
-- Create index requests_priorit_81e65d_idx on field(s) priority of model request
--
CREATE INDEX "requests_priorit_81e65d_idx" ON "requests" ("priority");
--
-- Create index requests_created_4c1c4c_idx on field(s) created_at of model request
--
CREATE INDEX "requests_created_4c1c4c_idx" ON "requests" ("created_at");
--
-- Create index approvals_request_732bce_idx on field(s) request of model approval
--
CREATE INDEX "approvals_request_732bce_idx" ON "approvals" ("request_id");
--
-- Create index approvals_perform_2b3658_idx on field(s) performed_by of model approval
--
CREATE INDEX "approvals_perform_2b3658_idx" ON "approvals" ("performed_by_id");
--
-- Create index approvals_perform_73a95b_idx on field(s) performed_at of model approval
--
CREATE INDEX "approvals_perform_73a95b_idx" ON "approvals" ("performed_at");
CREATE UNIQUE INDEX "workflow_steps_flow_step_code_06e65b6d_uniq" ON "workflow_steps" ("flow", "step_code");
CREATE UNIQUE INDEX "workflow_steps_flow_step_order_af295a13_uniq" ON "workflow_steps" ("flow", "step_order");
CREATE INDEX "workflow_st_flow_665300_idx" ON "workflow_steps" ("flow", "from_status");
CREATE INDEX "workflow_st_respons_231da5_idx" ON "workflow_steps" ("responsible_role");
CREATE INDEX "requests_current_step_id_df88bbe0" ON "requests" ("current_step_id");
CREATE INDEX "approvals_performed_by_id_104e38d6" ON "approvals" ("performed_by_id");
CREATE INDEX "approvals_request_id_1cea97f9" ON "approvals" ("request_id");
CREATE INDEX "approvals_workflow_step_id_2be78215" ON "approvals" ("workflow_step_id");
CREATE INDEX "notifications_is_read_27cb7368" ON "notifications" ("is_read");
CREATE INDEX "notifications_created_at_878ec15c" ON "notifications" ("created_at");
CREATE INDEX "notifications_user_id_468e288d" ON "notifications" ("user_id");
CREATE INDEX "notifications_request_id_a97e752b" ON "notifications" ("request_id");
CREATE INDEX "notificatio_user_id_a4dd5c_idx" ON "notifications" ("user_id", "is_read");
CREATE INDEX "claims_managed_by_id_19f8e1ac" ON "claims" ("managed_by_id");
CREATE INDEX "claims_raised_by_id_ded66abd" ON "claims" ("raised_by_id");
CREATE INDEX "claims_resolved_by_id_fa6b9446" ON "claims" ("resolved_by_id");
CREATE INDEX "claims_request_id_78b49863" ON "claims" ("request_id");
CREATE INDEX "claims_request_c42119_idx" ON "claims" ("request_id");
CREATE INDEX "claims_claim_t_dcccb3_idx" ON "claims" ("claim_type");
CREATE INDEX "claims_status_cb731f_idx" ON "claims" ("status");
CREATE INDEX "attachments_uploaded_by_id_ffd2878c" ON "attachments" ("uploaded_by_id");
CREATE INDEX "attachments_request_id_db659ef2" ON "attachments" ("request_id");
CREATE INDEX "attachments_request_beefaa_idx" ON "attachments" ("request_id");
CREATE INDEX "attachments_categor_de87ef_idx" ON "attachments" ("category");
CREATE INDEX "activity_log_user_id_f1e09264" ON "activity_log" ("user_id");
CREATE INDEX "activity_log_request_id_2170da20" ON "activity_log" ("request_id");
CREATE INDEX "activity_lo_request_3438dc_idx" ON "activity_log" ("request_id");
CREATE INDEX "activity_lo_user_id_ef3d5a_idx" ON "activity_log" ("user_id");
CREATE INDEX "activity_lo_created_8906e2_idx" ON "activity_log" ("created_at");
COMMIT;
BEGIN;
--
-- Create model Inventory
--
CREATE TABLE "inventory" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "product_code" varchar(50) NOT NULL UNIQUE, "description" varchar(300) NOT NULL, "unit" varchar(30) NOT NULL, "category" varchar(100) NOT NULL, "min_stock" decimal NOT NULL, "created_at" datetime NOT NULL);
--
-- Create model WarehouseDispatch
--
CREATE TABLE "warehouse_dispatches" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "dispatch_number" varchar(50) NOT NULL, "origin" varchar(10) NOT NULL, "dispatch_guide_number" varchar(50) NOT NULL, "dispatched_at" datetime NOT NULL, "delivered_at" datetime NULL, "notes" text NOT NULL, "accepted_by_id" bigint NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "destination_department_id" bigint NULL REFERENCES "departments" ("id") DEFERRABLE INITIALLY DEFERRED, "destination_project_id" bigint NULL REFERENCES "projects" ("id") DEFERRABLE INITIALLY DEFERRED, "dispatched_by_id" bigint NOT NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "request_id" bigint NOT NULL REFERENCES "requests" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model WarehouseDispatchItem
--
CREATE TABLE "warehouse_dispatch_items" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "quantity_dispatched" decimal NOT NULL, "quantity_delivered" decimal NULL, "created_at" datetime NOT NULL, "dispatch_id" bigint NOT NULL REFERENCES "warehouse_dispatches" ("id") DEFERRABLE INITIALLY DEFERRED, "request_item_id" bigint NOT NULL REFERENCES "request_items" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model WarehouseReceipt
--
CREATE TABLE "warehouse_receipts" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "receipt_number" varchar(50) NOT NULL, "supplier_guide_number" varchar(50) NOT NULL, "received_at" datetime NOT NULL, "conformity_passed" bool NULL, "conformity_checked_at" datetime NULL, "conformity_notes" text NOT NULL, "notes" text NOT NULL, "conformity_checked_by_id" bigint NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "purchase_order_id" bigint NULL REFERENCES "purchase_orders" ("id") DEFERRABLE INITIALLY DEFERRED, "received_by_id" bigint NOT NULL REFERENCES "users" ("id") DEFERRABLE INITIALLY DEFERRED, "request_id" bigint NOT NULL REFERENCES "requests" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Add field receipt to warehousedispatch
--
ALTER TABLE "warehouse_dispatches" ADD COLUMN "receipt_id" bigint NULL REFERENCES "warehouse_receipts" ("id") DEFERRABLE INITIALLY DEFERRED;
--
-- Create model WarehouseReceiptItem
--
CREATE TABLE "warehouse_receipt_items" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "quantity_received" decimal NOT NULL, "quantity_accepted" decimal NULL, "quantity_rejected" decimal NOT NULL, "rejection_reason" text NOT NULL, "notes" text NOT NULL, "created_at" datetime NOT NULL, "purchase_order_item_id" bigint NULL REFERENCES "purchase_order_items" ("id") DEFERRABLE INITIALLY DEFERRED, "receipt_id" bigint NOT NULL REFERENCES "warehouse_receipts" ("id") DEFERRABLE INITIALLY DEFERRED, "request_item_id" bigint NOT NULL REFERENCES "request_items" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create model InventoryStock
--
CREATE TABLE "inventory_stock" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "warehouse_type" varchar(10) NOT NULL, "quantity" decimal NOT NULL, "last_updated" datetime NOT NULL, "department_id" bigint NULL REFERENCES "departments" ("id") DEFERRABLE INITIALLY DEFERRED, "inventory_id" bigint NOT NULL REFERENCES "inventory" ("id") DEFERRABLE INITIALLY DEFERRED, "project_id" bigint NULL REFERENCES "projects" ("id") DEFERRABLE INITIALLY DEFERRED);
--
-- Create index warehouse_r_request_f749ae_idx on field(s) request of model warehousereceipt
--
CREATE INDEX "warehouse_r_request_f749ae_idx" ON "warehouse_receipts" ("request_id");
--
-- Create index warehouse_r_purchas_c2ed66_idx on field(s) purchase_order of model warehousereceipt
--
CREATE INDEX "warehouse_r_purchas_c2ed66_idx" ON "warehouse_receipts" ("purchase_order_id");
--
-- Create index warehouse_d_request_2db7cf_idx on field(s) request of model warehousedispatch
--
CREATE INDEX "warehouse_d_request_2db7cf_idx" ON "warehouse_dispatches" ("request_id");
CREATE INDEX "warehouse_dispatches_accepted_by_id_f9cc84cf" ON "warehouse_dispatches" ("accepted_by_id");
CREATE INDEX "warehouse_dispatches_destination_department_id_11a8f104" ON "warehouse_dispatches" ("destination_department_id");
CREATE INDEX "warehouse_dispatches_destination_project_id_a5e4a68a" ON "warehouse_dispatches" ("destination_project_id");
CREATE INDEX "warehouse_dispatches_dispatched_by_id_3d8f6a7b" ON "warehouse_dispatches" ("dispatched_by_id");
CREATE INDEX "warehouse_dispatches_request_id_315c94a4" ON "warehouse_dispatches" ("request_id");
CREATE INDEX "warehouse_dispatch_items_dispatch_id_2bf1dc01" ON "warehouse_dispatch_items" ("dispatch_id");
CREATE INDEX "warehouse_dispatch_items_request_item_id_38de1d91" ON "warehouse_dispatch_items" ("request_item_id");
CREATE INDEX "warehouse_receipts_conformity_checked_by_id_d54cfd6c" ON "warehouse_receipts" ("conformity_checked_by_id");
CREATE INDEX "warehouse_receipts_purchase_order_id_3666c51b" ON "warehouse_receipts" ("purchase_order_id");
CREATE INDEX "warehouse_receipts_received_by_id_9136eead" ON "warehouse_receipts" ("received_by_id");
CREATE INDEX "warehouse_receipts_request_id_732670fa" ON "warehouse_receipts" ("request_id");
CREATE INDEX "warehouse_dispatches_receipt_id_aa993e60" ON "warehouse_dispatches" ("receipt_id");
CREATE INDEX "warehouse_receipt_items_purchase_order_item_id_34d0de86" ON "warehouse_receipt_items" ("purchase_order_item_id");
CREATE INDEX "warehouse_receipt_items_receipt_id_a045a8c9" ON "warehouse_receipt_items" ("receipt_id");
CREATE INDEX "warehouse_receipt_items_request_item_id_90c9bd0e" ON "warehouse_receipt_items" ("request_item_id");
CREATE UNIQUE INDEX "inventory_stock_inventory_id_warehouse_type_project_id_department_id_f5c9e26e_uniq" ON "inventory_stock" ("inventory_id", "warehouse_type", "project_id", "department_id");
CREATE INDEX "inventory_stock_department_id_f0862f7a" ON "inventory_stock" ("department_id");
CREATE INDEX "inventory_stock_inventory_id_71de55ac" ON "inventory_stock" ("inventory_id");
CREATE INDEX "inventory_stock_project_id_08236c3b" ON "inventory_stock" ("project_id");
COMMIT;
