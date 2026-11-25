package com.bizflowjewelry.backend.auth;

import java.net.URI;

interface RecoveryDelivery {
    void send(String email, URI link);
}
