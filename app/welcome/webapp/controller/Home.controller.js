sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast"
], function (Controller, MessageToast) {
    "use strict";

    return Controller.extend("fuelsphere.welcome.controller.Home", {
        onInit: function () {
        },

        onOpenMasterData: function () {
            var sUrl = "/odata/v4/master/Airports";
            sap.m.URLHelper.redirect(sUrl, false);
        },

        onOpenFuelOrders: function () {
            var sUrl = "/odata/v4/orders/FuelOrders";
            sap.m.URLHelper.redirect(sUrl, false);
        },

        onOpenInvoices: function () {
            var sUrl = "/odata/v4/invoice/Invoices";
            sap.m.URLHelper.redirect(sUrl, false);
        }
    });
});
