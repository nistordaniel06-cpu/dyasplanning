package ro.dyasplanning.app;

import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Pornește / oprește blocarea capturilor de ecran, apelat din aplicația web în funcție de rol. */
@CapacitorPlugin(name = "ScreenGuard")
public class ScreenGuardPlugin extends Plugin {
    /** True dacă aplicația a fost construită cu google-services.json (Firebase), deci notificările pot fi activate. */
    @PluginMethod
    public void pushAvailable(PluginCall call) {
        int id = getContext().getResources().getIdentifier("google_app_id", "string", getContext().getPackageName());
        JSObject ret = new JSObject();
        ret.put("available", id != 0);
        call.resolve(ret);
    }

    @PluginMethod
    public void setSecure(PluginCall call) {
        final boolean secure = call.getBoolean("secure", true);
        getActivity().runOnUiThread(() -> {
            if (secure) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            } else {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            }
            JSObject ret = new JSObject();
            ret.put("secure", secure);
            call.resolve(ret);
        });
    }
}
