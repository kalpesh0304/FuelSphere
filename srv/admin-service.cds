/**
 * FuelSphere - Administration Service
 *
 * Manages configuration entities (DD-001, DD-002):
 * - Persona configuration
 * - Tile assignments
 * - Approval limits
 * - Audit log access
 *
 * Restricted to FullAdmin role
 */



using { fuelsphere as db } from '../db/schema';

@path: '/api/admin'
@requires: 'FullAdmin'
service AdminService {

    // ========================================================================
    // PERSONA CONFIGURATION (DD-001)
    // ========================================================================

    /**
     * CONFIG_PERSONAS - Seed data for personas
     * Delivered as recommended, customizable by admin
     */
    entity Personas as projection on db.CONFIG_PERSONAS;

    /**
     * CONFIG_TILES - Application tile definitions
     * Seed data for Fiori Launchpad tiles
     */
    entity Tiles as projection on db.CONFIG_TILES;

    /**
     * CONFIG_PERSONA_TILES - Persona-Tile mapping
     * Customizable by customer administrators
     */
    entity PersonaTiles as projection on db.CONFIG_PERSONA_TILES {
        *,
        persona : redirected to Personas,
        tile    : redirected to Tiles
    };

    /**
     * CONFIG_USER_PERSONAS - User-Persona assignments
     * Managed by customer administrators
     */
    entity UserPersonas as projection on db.CONFIG_USER_PERSONAS {
        *,
        persona : redirected to Personas
    };

    // ========================================================================
    // APPROVAL LIMITS CONFIGURATION (DD-002)
    // ========================================================================

    /**
     * CONFIG_APPROVAL_LIMITS - Approval threshold configuration
     * Setup data, configurable at deployment
     */
    entity ApprovalLimits as projection on db.CONFIG_APPROVAL_LIMITS {
        *,
        persona : redirected to Personas
    };

    // ========================================================================
    // AUDIT LOG
    // ========================================================================

    /**
     * AUDIT_LOG - System audit trail
     * Read-only access for compliance review
     */
    @readonly
    entity AuditLog as projection on db.AUDIT_LOG;

    // ========================================================================
    // ADMINISTRATIVE ACTIONS
    // ========================================================================

    /**
     * Initialize seed data for personas and tiles
     */
    action initializeSeedData() returns InitResult;

    /**
     * Assign persona to user
     */
    action assignPersonaToUser(
        userId    : String,
        personaId : String,
        station   : String,
        region    : String
    ) returns Boolean;

    /**
     * Set approval limit for persona
     */
    action setApprovalLimit(
        personaId : String,
        limitType : String,
        limitValue: Decimal
    ) returns Boolean;

    /**
     * Export audit log for compliance
     */
    action exportAuditLog(
        fromDate  : DateTime,
        toDate    : DateTime,
        entityName: String
    ) returns String; // Returns download URL

    type InitResult {
        personasCreated : Integer;
        tilesCreated    : Integer;
        mappingsCreated : Integer;
        limitsCreated   : Integer;
    }
}
