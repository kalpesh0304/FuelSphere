sap.ui.define([
    "sap/m/Shell",
    "sap/ui/core/ComponentContainer",
    "sap/base/util/UriParameters"
], function(Shell, ComponentContainer, UriParameters) {
    "use strict";

    // Create shell with component
    var oShell = new Shell({
        app: new ComponentContainer({
            name: "fuelsphere.airports",
            manifest: true,
            async: true,
            height: "100%",
            settings: {
                id: "airports"
            }
        }),
        appWidthLimited: false
    });

    oShell.placeAt("content");
});
