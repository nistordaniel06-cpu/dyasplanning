package ro.dyasplanning.app;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

/**
 * DYASPlanning: încarcă aplicația web și blochează capturile de ecran (FLAG_SECURE).
 * Blocarea e activă din start; site-ul o dezactivează doar pentru administrator (vezi ScreenGuardPlugin).
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ScreenGuardPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    }
}
