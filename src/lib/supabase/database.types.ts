
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "api": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "amend_entry":
{ Args: { "p_entry_id": string,"p_idempotency_key": string,"p_new": Json }; Returns: string
                           },
"archive_account":
{ Args: { "p_account_id": string }; Returns: undefined
                           },
"create_account":
{ Args: { "p_currency": string,"p_idempotency_key": string,"p_include_in_budget"?: boolean,"p_institution"?: string,"p_kind": Database["public"]['Enums']["account_kind"],"p_linked_envelope_id"?: string,"p_name": string,"p_opening_balance"?: string,"p_opening_on"?: string,"p_opening_rate"?: string }; Returns: string
                           },
"fx_rate":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "as_of": string,"rate": string,"source": string
            }[]
                           },
"purge_account":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"reallocate":
{ Args: { "p_amount": string,"p_from_envelope_id": string,"p_idempotency_key": string,"p_occurred_on": string,"p_to_envelope_id": string }; Returns: string
                           },
"record_adjustment":
{ Args: { "p_account_id": string,"p_fx_rate"?: string,"p_idempotency_key": string,"p_occurred_on": string,"p_target_balance": string }; Returns: string
                           },
"record_expense":
{ Args: { "p_account_id": string,"p_amount": string,"p_category_id"?: string,"p_envelope_id"?: string,"p_fx_rate"?: string,"p_idempotency_key": string,"p_note"?: string,"p_occurred_on": string }; Returns: string
                           },
"record_income":
{ Args: { "p_account_id": string,"p_allocation"?: Json,"p_amount": string,"p_category_id"?: string,"p_fx_rate"?: string,"p_idempotency_key": string,"p_note"?: string,"p_occurred_on": string }; Returns: string
                           },
"record_revaluation":
{ Args: { "p_account_id": string,"p_idempotency_key": string,"p_occurred_on": string,"p_rate": string }; Returns: string
                           },
"record_transfer":
{ Args: { "p_amount_from": string,"p_amount_to": string,"p_envelope_id"?: string,"p_from_account_id": string,"p_fx_rate"?: string,"p_idempotency_key": string,"p_note"?: string,"p_occurred_on": string,"p_to_account_id": string }; Returns: string
                           },
"reverse_entry":
{ Args: { "p_entry_id": string,"p_idempotency_key": string }; Returns: string
                           },
"set_ai_consent":
{ Args: { "p_consent": boolean }; Returns: string
                           },
"setup_budget":
{ Args: { "p_base_currency": string,"p_custom"?: Json,"p_method": Database["public"]['Enums']["budget_method"] }; Returns: string
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "accounts": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"currency": string,"id": string,"idempotency_key": string | null,"include_in_budget": boolean,"institution": string | null,"kind": Database["public"]['Enums']["account_kind"],"linked_envelope_id": string | null,"name": string,"request_hash": string | null,"system_role": Database["public"]['Enums']["system_role"] | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"currency": string,"id"?: string,"idempotency_key"?: string | null,"include_in_budget"?: boolean,"institution"?: string | null,"kind": Database["public"]['Enums']["account_kind"],"linked_envelope_id"?: string | null,"name": string,"request_hash"?: string | null,"system_role"?: Database["public"]['Enums']["system_role"] | null,"user_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"currency"?: string,"id"?: string,"idempotency_key"?: string | null,"include_in_budget"?: boolean,"institution"?: string | null,"kind"?: Database["public"]['Enums']["account_kind"],"linked_envelope_id"?: string | null,"name"?: string,"request_hash"?: string | null,"system_role"?: Database["public"]['Enums']["system_role"] | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "accounts_currency_fkey"
      columns: ["currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "accounts_linked_envelope_id_user_id_fkey"
      columns: ["linked_envelope_id","user_id"]
isOneToOne: false
      referencedRelation: "envelope_balances"
      referencedColumns: ["envelope_id","user_id"]
    },{
      foreignKeyName: "accounts_linked_envelope_id_user_id_fkey"
      columns: ["linked_envelope_id","user_id"]
isOneToOne: false
      referencedRelation: "envelopes"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"budgets": {
                  Row: {
                    "base_currency": string,"created_at": string,"id": string,"is_active": boolean,"method": Database["public"]['Enums']["budget_method"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "base_currency": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"method": Database["public"]['Enums']["budget_method"],"user_id": string
                  }
                  Update: {
                    "base_currency"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"method"?: Database["public"]['Enums']["budget_method"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "budgets_base_currency_fkey"
      columns: ["base_currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    }
                  ]
                },"categories": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"default_envelope_id": string | null,"icon": string | null,"id": string,"kind": Database["public"]['Enums']["category_kind"],"name": string | null,"name_key": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"default_envelope_id"?: string | null,"icon"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["category_kind"],"name"?: string | null,"name_key"?: string | null,"user_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"default_envelope_id"?: string | null,"icon"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["category_kind"],"name"?: string | null,"name_key"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_default_envelope_id_user_id_fkey"
      columns: ["default_envelope_id","user_id"]
isOneToOne: false
      referencedRelation: "envelope_balances"
      referencedColumns: ["envelope_id","user_id"]
    },{
      foreignKeyName: "categories_default_envelope_id_user_id_fkey"
      columns: ["default_envelope_id","user_id"]
isOneToOne: false
      referencedRelation: "envelopes"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"currencies": {
                  Row: {
                    "code": string,"minor_units": number,"symbol": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"minor_units": number,"symbol": string
                  }
                  Update: {
                    "code"?: string,"minor_units"?: number,"symbol"?: string
                  }
                  Relationships: [
                    
                  ]
                },"envelope_lines": {
                  Row: {
                    "amount_minor": number,"entry_id": string,"envelope_id": string,"fx_rate": number | null,"id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_minor": number,"entry_id": string,"envelope_id": string,"fx_rate"?: number | null,"id"?: string,"user_id": string
                  }
                  Update: {
                    "amount_minor"?: number,"entry_id"?: string,"envelope_id"?: string,"fx_rate"?: number | null,"id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "envelope_lines_entry_id_user_id_fkey"
      columns: ["entry_id","user_id"]
isOneToOne: false
      referencedRelation: "ledger_entries"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "envelope_lines_entry_id_user_id_fkey"
      columns: ["entry_id","user_id"]
isOneToOne: false
      referencedRelation: "reportable_entries"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "envelope_lines_envelope_id_user_id_fkey"
      columns: ["envelope_id","user_id"]
isOneToOne: false
      referencedRelation: "envelope_balances"
      referencedColumns: ["envelope_id","user_id"]
    },{
      foreignKeyName: "envelope_lines_envelope_id_user_id_fkey"
      columns: ["envelope_id","user_id"]
isOneToOne: false
      referencedRelation: "envelopes"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"envelopes": {
                  Row: {
                    "allocation_bps": number,"archived_at": string | null,"budget_id": string,"created_at": string,"id": string,"is_system": boolean,"kind": Database["public"]['Enums']["envelope_kind"],"name": string | null,"name_key": string | null,"sort_order": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allocation_bps": number,"archived_at"?: string | null,"budget_id": string,"created_at"?: string,"id"?: string,"is_system"?: boolean,"kind": Database["public"]['Enums']["envelope_kind"],"name"?: string | null,"name_key"?: string | null,"sort_order": number,"user_id": string
                  }
                  Update: {
                    "allocation_bps"?: number,"archived_at"?: string | null,"budget_id"?: string,"created_at"?: string,"id"?: string,"is_system"?: boolean,"kind"?: Database["public"]['Enums']["envelope_kind"],"name"?: string | null,"name_key"?: string | null,"sort_order"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "envelopes_budget_id_user_id_fkey"
      columns: ["budget_id","user_id"]
isOneToOne: false
      referencedRelation: "budgets"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"ledger_entries": {
                  Row: {
                    "category_id": string | null,"created_at": string,"id": string,"idempotency_key": string,"kind": Database["public"]['Enums']["entry_kind"],"note": string | null,"occurred_on": string,"request_hash": string,"reverses_entry_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id"?: string | null,"created_at"?: string,"id"?: string,"idempotency_key": string,"kind": Database["public"]['Enums']["entry_kind"],"note"?: string | null,"occurred_on": string,"request_hash": string,"reverses_entry_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "category_id"?: string | null,"created_at"?: string,"id"?: string,"idempotency_key"?: string,"kind"?: Database["public"]['Enums']["entry_kind"],"note"?: string | null,"occurred_on"?: string,"request_hash"?: string,"reverses_entry_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_entries_category_id_user_id_fkey"
      columns: ["category_id","user_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "ledger_entries_reverses_entry_id_user_id_fkey"
      columns: ["reverses_entry_id","user_id"]
isOneToOne: false
      referencedRelation: "ledger_entries"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "ledger_entries_reverses_entry_id_user_id_fkey"
      columns: ["reverses_entry_id","user_id"]
isOneToOne: false
      referencedRelation: "reportable_entries"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"ledger_lines": {
                  Row: {
                    "account_id": string,"amount_minor": number,"base_amount_minor": number | null,"currency": string,"entry_id": string,"id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"amount_minor": number,"base_amount_minor"?: number | null,"currency": string,"entry_id": string,"id"?: string,"user_id": string
                  }
                  Update: {
                    "account_id"?: string,"amount_minor"?: number,"base_amount_minor"?: number | null,"currency"?: string,"entry_id"?: string,"id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_lines_account_id_user_id_fkey"
      columns: ["account_id","user_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["account_id","user_id"]
    },{
      foreignKeyName: "ledger_lines_account_id_user_id_fkey"
      columns: ["account_id","user_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "ledger_lines_currency_fkey"
      columns: ["currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "ledger_lines_entry_id_user_id_fkey"
      columns: ["entry_id","user_id"]
isOneToOne: false
      referencedRelation: "ledger_entries"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "ledger_lines_entry_id_user_id_fkey"
      columns: ["entry_id","user_id"]
isOneToOne: false
      referencedRelation: "reportable_entries"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"limits": {
                  Row: {
                    "category_id": string | null,"created_at": string,"envelope_id": string | null,"id": string,"limit_minor": number,"period_month": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id"?: string | null,"created_at"?: string,"envelope_id"?: string | null,"id"?: string,"limit_minor": number,"period_month"?: string | null,"user_id": string
                  }
                  Update: {
                    "category_id"?: string | null,"created_at"?: string,"envelope_id"?: string | null,"id"?: string,"limit_minor"?: number,"period_month"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "limits_category_id_user_id_fkey"
      columns: ["category_id","user_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "limits_envelope_id_user_id_fkey"
      columns: ["envelope_id","user_id"]
isOneToOne: false
      referencedRelation: "envelope_balances"
      referencedColumns: ["envelope_id","user_id"]
    },{
      foreignKeyName: "limits_envelope_id_user_id_fkey"
      columns: ["envelope_id","user_id"]
isOneToOne: false
      referencedRelation: "envelopes"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "ai_consent_at": string | null,"base_currency": string,"created_at": string,"display_name": string | null,"id": string,"locale": string,"onboarded_at": string | null,"theme": string,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_consent_at"?: string | null,"base_currency"?: string,"created_at"?: string,"display_name"?: string | null,"id": string,"locale"?: string,"onboarded_at"?: string | null,"theme"?: string,"timezone"?: string
                  }
                  Update: {
                    "ai_consent_at"?: string | null,"base_currency"?: string,"created_at"?: string,"display_name"?: string | null,"id"?: string,"locale"?: string,"onboarded_at"?: string | null,"theme"?: string,"timezone"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_base_currency_fkey"
      columns: ["base_currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    }
                  ]
                },"reference_rates": {
                  Row: {
                    "currency": string,"fetched_at": string,"kzt_per_unit": number,"rate_date": string,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "currency": string,"fetched_at"?: string,"kzt_per_unit": number,"rate_date": string,"source"?: string
                  }
                  Update: {
                    "currency"?: string,"fetched_at"?: string,"kzt_per_unit"?: number,"rate_date"?: string,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reference_rates_currency_fkey"
      columns: ["currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    }
                  ]
                },"savings_goals": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"envelope_id": string,"id": string,"target_date": string | null,"target_minor": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"envelope_id": string,"id"?: string,"target_date"?: string | null,"target_minor": number,"user_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"envelope_id"?: string,"id"?: string,"target_date"?: string | null,"target_minor"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "savings_goals_envelope_id_user_id_fkey"
      columns: ["envelope_id","user_id"]
isOneToOne: false
      referencedRelation: "envelope_balances"
      referencedColumns: ["envelope_id","user_id"]
    },{
      foreignKeyName: "savings_goals_envelope_id_user_id_fkey"
      columns: ["envelope_id","user_id"]
isOneToOne: false
      referencedRelation: "envelopes"
      referencedColumns: ["id","user_id"]
    }
                  ]
                }
          }
          Views: {
            "account_balances": {
                  Row: {
                    "account_id": string,"archived_at": string | null,"balance_minor": string | null,"book_value_minor": string | null,"currency": string,"include_in_budget": boolean,"kind": Database["public"]['Enums']["account_kind"],"linked_envelope_id": string | null,"name": string,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "accounts_currency_fkey"
      columns: ["currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "accounts_linked_envelope_id_user_id_fkey"
      columns: ["linked_envelope_id","user_id"]
isOneToOne: false
      referencedRelation: "envelope_balances"
      referencedColumns: ["envelope_id","user_id"]
    },{
      foreignKeyName: "accounts_linked_envelope_id_user_id_fkey"
      columns: ["linked_envelope_id","user_id"]
isOneToOne: false
      referencedRelation: "envelopes"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"category_monthly": {
                  Row: {
                    "category_id": string | null,"expense_minor": string | null,"month": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "ledger_entries_category_id_user_id_fkey"
      columns: ["category_id","user_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"envelope_balances": {
                  Row: {
                    "allocation_bps": number,"archived_at": string | null,"balance_minor": string | null,"budget_id": string,"envelope_id": string,"kind": Database["public"]['Enums']["envelope_kind"],"name": string | null,"name_key": string | null,"sort_order": number,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "envelopes_budget_id_user_id_fkey"
      columns: ["budget_id","user_id"]
isOneToOne: false
      referencedRelation: "budgets"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"monthly_summary": {
                  Row: {
                    "expense_minor": string | null,"income_minor": string | null,"month": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"reportable_entries": {
                  Row: {
                    "category_id": string | null,"created_at": string,"id": string,"idempotency_key": string,"kind": Database["public"]['Enums']["entry_kind"],"note": string | null,"occurred_on": string,"request_hash": string,"reverses_entry_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                           "category_id"?: string | null,"created_at"?: string | null,"id"?: string | null,"idempotency_key"?: string | null,"kind"?: Database["public"]['Enums']["entry_kind"] | null,"note"?: string | null,"occurred_on"?: string | null,"request_hash"?: string | null,"reverses_entry_id"?: string | null,"user_id"?: string | null
                         }
                        Update: {
                           "category_id"?: string | null,"created_at"?: string | null,"id"?: string | null,"idempotency_key"?: string | null,"kind"?: Database["public"]['Enums']["entry_kind"] | null,"note"?: string | null,"occurred_on"?: string | null,"request_hash"?: string | null,"reverses_entry_id"?: string | null,"user_id"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "ledger_entries_category_id_user_id_fkey"
      columns: ["category_id","user_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "ledger_entries_reverses_entry_id_user_id_fkey"
      columns: ["reverses_entry_id","user_id"]
isOneToOne: false
      referencedRelation: "ledger_entries"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "ledger_entries_reverses_entry_id_user_id_fkey"
      columns: ["reverses_entry_id","user_id"]
isOneToOne: false
      referencedRelation: "reportable_entries"
      referencedColumns: ["id","user_id"]
    }
                  ]
                }
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            "account_kind": "cash"|"card"|"current"|"savings"|"deposit"|"system","budget_method": "50_30_20"|"80_20"|"90_10"|"70_20_10"|"custom","category_kind": "income"|"expense","entry_kind": "opening_balance"|"income"|"expense"|"transfer"|"allocation"|"adjustment"|"fx_revaluation"|"reversal","envelope_kind": "needs"|"wants"|"savings"|"spending"|"living"|"debt_giving"|"custom"|"unallocated","system_role": "income"|"expense"|"opening_balance"|"fx_clearing"|"adjustment"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "api": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "account_kind": ["cash", "card", "current", "savings", "deposit", "system"],"budget_method": ["50_30_20", "80_20", "90_10", "70_20_10", "custom"],"category_kind": ["income", "expense"],"entry_kind": ["opening_balance", "income", "expense", "transfer", "allocation", "adjustment", "fx_revaluation", "reversal"],"envelope_kind": ["needs", "wants", "savings", "spending", "living", "debt_giving", "custom", "unallocated"],"system_role": ["income", "expense", "opening_balance", "fx_clearing", "adjustment"]
          }
        }
} as const
